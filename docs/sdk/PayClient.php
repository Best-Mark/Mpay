<?php

declare(strict_types=1);

/**
 * 统一支付中心 · PHP 接入 SDK（零依赖，仅需 curl 扩展，PHP 7.4+）
 *
 * 用法：
 *   $client = new PayClient('https://pay.example.com', $appId, $appSecret);
 *   $order  = $client->createOrder([
 *       'merchantOrderNo' => 'ORDER_001',
 *       'amount'          => '128.50',
 *       'subject'         => '会员年卡',
 *       'tradeType'       => 'NATIVE',
 *   ]);
 *
 * 约定：
 *   - 金额一律字符串（元，两位小数），禁止浮点运算
 *   - 所有写接口带幂等键（merchantOrderNo / merchantRefundNo），重试安全
 *   - code != 0 抛出 PayException（含 payCode / traceId）
 */

final class PayClient
{
    public const PATH_PAY_CREATE = '/api/v1/open/pay/create';
    public const PATH_PAY_QUERY = '/api/v1/open/pay/query';
    public const PATH_PAY_CLOSE = '/api/v1/open/pay/close';
    public const PATH_PAY_CHANNELS = '/api/v1/open/pay/channels';
    /** 渠道自动路由：不传 channel 时由支付中心自动选择，新增渠道无需升级 SDK */
    public const CHANNEL_AUTO = 'auto';
    public const PATH_REFUND_CREATE = '/api/v1/open/refund/create';
    public const PATH_REFUND_QUERY = '/api/v1/open/refund/query';

    private string $baseUrl;
    private string $appId;
    private string $appSecret;
    private int $timeoutMs;

    public function __construct(string $baseUrl, string $appId, string $appSecret, int $timeoutMs = 10000)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->appId = $appId;
        $this->appSecret = $appSecret;
        $this->timeoutMs = $timeoutMs;
    }

    /** 下单（幂等：同一 merchantOrderNo 返回同一订单） */
    public function createOrder(array $params): array
    {
        // 未指定渠道时由服务端路由
        $params += ['channel' => self::CHANNEL_AUTO];
        return $this->post(self::PATH_PAY_CREATE, $params);
    }

    /** 查询当前应用可用渠道，新增渠道会自动出现，无需升级 SDK */
    public function listChannels(): array
    {
        return $this->post(self::PATH_PAY_CHANNELS, ['appId' => $this->appId]);
    }

    /** 查单：['payOrderNo' => ...] 或 ['merchantOrderNo' => ...] */
    public function queryOrder(array $params): array
    {
        return $this->post(self::PATH_PAY_QUERY, $params);
    }

    /** 关闭未支付订单 */
    public function closeOrder(string $payOrderNo): array
    {
        return $this->post(self::PATH_PAY_CLOSE, ['payOrderNo' => $payOrderNo]);
    }

    /** 退款（幂等键 merchantRefundNo） */
    public function refund(array $params): array
    {
        return $this->post(self::PATH_REFUND_CREATE, $params);
    }

    /** 查退款：['refundNo' => ...] 或 ['merchantRefundNo' => ...] */
    public function queryRefund(array $params): array
    {
        return $this->post(self::PATH_REFUND_QUERY, $params);
    }

    /**
     * 校验支付中心推送的通知签名（务必在业务落库前校验）
     *
     * @param array  $headers 原始请求头（key 大小写不敏感）
     * @param string $rawBody 未经任何解析的原始 body 字符串
     */
    public function verifyNotify(array $headers, string $rawBody): bool
    {
        $ts = self::header($headers, 'x-pay-timestamp');
        $nonce = self::header($headers, 'x-pay-nonce');
        $sign = self::header($headers, 'x-pay-sign');
        $appId = self::header($headers, 'x-pay-app-id');
        if ($ts === '' || $nonce === '' || $sign === '') {
            return false;
        }
        $id = $appId !== '' ? $appId : $this->appId;
        $content = implode("\n", [$id, $ts, $nonce, self::sha256Hex($rawBody)]);
        return hash_equals(self::hmacSha256Hex($this->appSecret, $content), strtolower($sign));
    }

    /** 构造签名请求头：待签串 = appId \n timestamp \n nonce \n METHOD \n path \n sha256(body) */
    public function buildSignHeaders(string $method, string $path, string $body): array
    {
        $timestamp = (string) time();
        $nonce = self::randomHex(12);
        $content = implode("\n", [
            $this->appId,
            $timestamp,
            $nonce,
            strtoupper($method),
            $path,
            self::sha256Hex($body),
        ]);
        return [
            'X-App-Id' => $this->appId,
            'X-Timestamp' => $timestamp,
            'X-Nonce' => $nonce,
            'X-Sign' => self::hmacSha256Hex($this->appSecret, $content),
        ];
    }

    private function post(string $path, array $payload): array
    {
        if (!isset($payload['appId'])) {
            $payload['appId'] = $this->appId;
        }
        // 参与签名与发送的必须是同一个字符串
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $headers = ['Content-Type: application/json'];
        foreach ($this->buildSignHeaders('POST', $path, $body) as $k => $v) {
            $headers[] = $k . ': ' . $v;
        }

        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS => $this->timeoutMs,
            CURLOPT_CONNECTTIMEOUT_MS => 5000,
        ]);
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new PayException(-1, '请求支付中心失败：' . $err);
        }

        $resp = json_decode((string) $raw, true);
        if (!is_array($resp)) {
            throw new PayException(-1, '响应解析失败：' . $raw);
        }
        $code = (int) ($resp['code'] ?? -1);
        if ($code !== 0) {
            throw new PayException($code, (string) ($resp['message'] ?? '支付中心返回失败'), $resp['traceId'] ?? null);
        }
        return is_array($resp['data'] ?? null) ? $resp['data'] : [];
    }

    private static function header(array $headers, string $lowerName): string
    {
        if (array_key_exists($lowerName, $headers)) {
            return (string) $headers[$lowerName];
        }
        foreach ($headers as $k => $v) {
            if (is_string($k) && strtolower($k) === $lowerName) {
                return (string) $v;
            }
        }
        return '';
    }

    private static function randomHex(int $bytes): string
    {
        return bin2hex(random_bytes($bytes));
    }

    private static function sha256Hex(string $s): string
    {
        return hash('sha256', $s);
    }

    private static function hmacSha256Hex(string $key, string $msg): string
    {
        return hash_hmac('sha256', $msg, $key);
    }
}

/** 支付中心返回的业务异常（code != 0） */
final class PayException extends RuntimeException
{
    public int $payCode;
    public ?string $traceId;

    public function __construct(int $code, string $message, ?string $traceId = null)
    {
        parent::__construct('[' . $code . '] ' . $message);
        $this->payCode = $code;
        $this->traceId = $traceId;
    }
}
