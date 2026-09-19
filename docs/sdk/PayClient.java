package com.example.pay;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 统一支付中心 · Java 接入 SDK（零第三方依赖，JDK 11+）
 *
 * 用法：
 * <pre>{@code
 * PayClient client = new PayClient("https://pay.example.com", appId, appSecret);
 * Map<String, Object> order = client.createOrder(Map.of(
 *     "merchantOrderNo", "ORDER_001",
 *     "amount", "128.50",
 *     "subject", "会员年卡",
 *     "tradeType", "NATIVE"));
 * }</pre>
 *
 * 约定：
 *   - 金额一律字符串（元，两位小数），禁止浮点运算
 *   - 所有写接口带幂等键（merchantOrderNo / merchantRefundNo），重试安全
 *   - code != 0 抛出 PayException（含 code / traceId）
 */
public final class PayClient {

    public static final String PATH_PAY_CREATE = "/api/v1/open/pay/create";
    public static final String PATH_PAY_QUERY = "/api/v1/open/pay/query";
    public static final String PATH_PAY_CLOSE = "/api/v1/open/pay/close";
    public static final String PATH_REFUND_CREATE = "/api/v1/open/refund/create";
    public static final String PATH_REFUND_QUERY = "/api/v1/open/refund/query";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final String baseUrl;
    private final String appId;
    private final String appSecret;
    private final HttpClient http;
    private final Duration timeout;

    public PayClient(String baseUrl, String appId, String appSecret) {
        this(baseUrl, appId, appSecret, Duration.ofSeconds(10));
    }

    public PayClient(String baseUrl, String appId, String appSecret, Duration timeout) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.appId = appId;
        this.appSecret = appSecret;
        this.timeout = timeout;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
    }

    /** 下单（幂等：同一 merchantOrderNo 返回同一订单） */
    public Map<String, Object> createOrder(Map<String, Object> params) {
        return post(PATH_PAY_CREATE, params);
    }

    /** 查单：{ payOrderNo } 或 { merchantOrderNo } */
    public Map<String, Object> queryOrder(Map<String, Object> params) {
        return post(PATH_PAY_QUERY, params);
    }

    /** 关闭未支付订单 */
    public Map<String, Object> closeOrder(String payOrderNo) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("payOrderNo", payOrderNo);
        return post(PATH_PAY_CLOSE, params);
    }

    /** 退款（幂等键 merchantRefundNo） */
    public Map<String, Object> refund(Map<String, Object> params) {
        return post(PATH_REFUND_CREATE, params);
    }

    /** 查退款：{ refundNo } 或 { merchantRefundNo } */
    public Map<String, Object> queryRefund(Map<String, Object> params) {
        return post(PATH_REFUND_QUERY, params);
    }

    /**
     * 校验支付中心推送的通知签名（务必在业务落库前校验）
     *
     * @param headers 原始请求头（key 大小写不敏感）
     * @param rawBody 未经任何解析的原始 body 字符串
     */
    public boolean verifyNotify(Map<String, String> headers, String rawBody) {
        String ts = header(headers, "x-pay-timestamp");
        String nonce = header(headers, "x-pay-nonce");
        String sign = header(headers, "x-pay-sign");
        String appIdOfNotify = header(headers, "x-pay-app-id");
        if (ts.isEmpty() || nonce.isEmpty() || sign.isEmpty()) return false;

        String id = appIdOfNotify.isEmpty() ? appId : appIdOfNotify;
        String body = rawBody == null ? "" : rawBody;
        String content = String.join("\n", id, ts, nonce, sha256Hex(body));
        return constantTimeEquals(hmacSha256Hex(appSecret, content), sign.toLowerCase(Locale.ROOT));
    }

    /** 构造签名请求头：待签串 = appId \n timestamp \n nonce \n METHOD \n path \n sha256(body) */
    public Map<String, String> buildSignHeaders(String method, String path, String body) {
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000);
        String nonce = randomHex(12);
        String content = String.join("\n", appId, timestamp, nonce, method.toUpperCase(Locale.ROOT), path, sha256Hex(body));
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-App-Id", appId);
        headers.put("X-Timestamp", timestamp);
        headers.put("X-Nonce", nonce);
        headers.put("X-Sign", hmacSha256Hex(appSecret, content));
        return headers;
    }

    private Map<String, Object> post(String path, Map<String, Object> payload) {
        Map<String, Object> body = new LinkedHashMap<>(payload == null ? new LinkedHashMap<>() : payload);
        body.putIfAbsent("appId", appId);
        // 参与签名与发送的必须是同一个字符串
        String json = Json.write(body);

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(timeout.plusSeconds(5))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8));
        buildSignHeaders("POST", path, json).forEach(builder::header);

        String raw;
        try {
            HttpResponse<String> resp = http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            raw = resp.body();
        } catch (Exception e) {
            throw new PayException(-1, "请求支付中心失败：" + e.getMessage(), null);
        }

        Object parsed = Json.parse(raw);
        if (!(parsed instanceof Map)) {
            throw new PayException(-1, "响应解析失败：" + raw, null);
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> resp = (Map<String, Object>) parsed;
        int code = resp.get("code") instanceof Number ? ((Number) resp.get("code")).intValue() : -1;
        if (code != 0) {
            String message = resp.get("message") == null ? "支付中心返回失败" : String.valueOf(resp.get("message"));
            String traceId = resp.get("traceId") == null ? null : String.valueOf(resp.get("traceId"));
            throw new PayException(code, message, traceId);
        }
        Object data = resp.get("data");
        if (data instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) data;
            return typed;
        }
        Map<String, Object> empty = new LinkedHashMap<>();
        if (data != null) empty.put("value", data);
        return empty;
    }

    private static String header(Map<String, String> headers, String lowerName) {
        if (headers == null) return "";
        String direct = headers.get(lowerName);
        if (direct != null) return direct;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(lowerName)) return e.getValue() == null ? "" : e.getValue();
        }
        return "";
    }

    private static String randomHex(int bytes) {
        byte[] buf = new byte[bytes];
        RANDOM.nextBytes(buf);
        return hex(buf);
    }

    private static String sha256Hex(String s) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String hmacSha256Hex(String key, String msg) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return hex(mac.doFinal(msg.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String hex(byte[] data) {
        StringBuilder sb = new StringBuilder(data.length * 2);
        for (byte b : data) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        if (a.length() != b.length()) return false;
        int diff = 0;
        for (int i = 0; i < a.length(); i++) diff |= a.charAt(i) ^ b.charAt(i);
        return diff == 0;
    }

    /** 支付中心返回的业务异常（code != 0） */
    public static final class PayException extends RuntimeException {
        private final int code;
        private final String traceId;

        PayException(int code, String message, String traceId) {
            super("[" + code + "] " + message);
            this.code = code;
            this.traceId = traceId;
        }

        public int getCode() {
            return code;
        }

        public String getTraceId() {
            return traceId;
        }
    }

    /** 极简 JSON 读写（避免引入 Jackson / Gson 等第三方依赖） */
    static final class Json {
        private final String s;
        private int i;

        private Json(String s) {
            this.s = s;
        }

        static Object parse(String s) {
            if (s == null || s.isEmpty()) return null;
            Json p = new Json(s);
            p.ws();
            return p.value();
        }

        static String write(Object o) {
            StringBuilder sb = new StringBuilder();
            write(o, sb);
            return sb.toString();
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        private Object value() {
            ws();
            char c = s.charAt(i);
            switch (c) {
                case '{': return object();
                case '[': return array();
                case '"': return string();
                case 't': i += 4; return Boolean.TRUE;
                case 'f': i += 5; return Boolean.FALSE;
                case 'n': i += 4; return null;
                default: return number();
            }
        }

        private Map<String, Object> object() {
            i++;
            Map<String, Object> m = new LinkedHashMap<>();
            ws();
            if (s.charAt(i) == '}') { i++; return m; }
            while (true) {
                ws();
                String k = string();
                ws();
                i++; // ':'
                m.put(k, value());
                ws();
                char c = s.charAt(i++);
                if (c == '}') break;
            }
            return m;
        }

        private List<Object> array() {
            i++;
            List<Object> list = new ArrayList<>();
            ws();
            if (s.charAt(i) == ']') { i++; return list; }
            while (true) {
                list.add(value());
                ws();
                char c = s.charAt(i++);
                if (c == ']') break;
            }
            return list;
        }

        private String string() {
            i++;
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') break;
                if (c != '\\') { sb.append(c); continue; }
                char esc = s.charAt(i++);
                switch (esc) {
                    case 'n': sb.append('\n'); break;
                    case 't': sb.append('\t'); break;
                    case 'r': sb.append('\r'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'u':
                        sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        i += 4;
                        break;
                    default: sb.append(esc);
                }
            }
            return sb.toString();
        }

        private Object number() {
            int start = i;
            while (i < s.length() && "-+.eE0123456789".indexOf(s.charAt(i)) >= 0) i++;
            String text = s.substring(start, i);
            if (text.contains(".") || text.contains("e") || text.contains("E")) return Double.valueOf(text);
            return Long.valueOf(text);
        }

        private static void write(Object o, StringBuilder sb) {
            if (o == null) {
                sb.append("null");
            } else if (o instanceof String) {
                writeString((String) o, sb);
            } else if (o instanceof Boolean || o instanceof Number) {
                sb.append(o);
            } else if (o instanceof Map<?, ?>) {
                sb.append('{');
                boolean first = true;
                for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                    if (!first) sb.append(',');
                    first = false;
                    writeString(String.valueOf(e.getKey()), sb);
                    sb.append(':');
                    write(e.getValue(), sb);
                }
                sb.append('}');
            } else if (o instanceof Iterable<?>) {
                sb.append('[');
                boolean first = true;
                for (Object v : (Iterable<?>) o) {
                    if (!first) sb.append(',');
                    first = false;
                    write(v, sb);
                }
                sb.append(']');
            } else {
                writeString(String.valueOf(o), sb);
            }
        }

        private static void writeString(String s, StringBuilder sb) {
            sb.append('"');
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"': sb.append("\\\""); break;
                    case '\\': sb.append("\\\\"); break;
                    case '\n': sb.append("\\n"); break;
                    case '\r': sb.append("\\r"); break;
                    case '\t': sb.append("\\t"); break;
                    default:
                        if (c < 0x20) sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                        else sb.append(c);
                }
            }
            sb.append('"');
        }
    }
}
