// Package payclient 是「统一支付中心」的 Go 接入 SDK（零依赖，仅用标准库 net/http，Go 1.18+）
//
// 用法：
//
//	client := payclient.New("https://pay.example.com", appID, appSecret)
//	order, err := client.CreateOrder(map[string]any{
//	    "merchantOrderNo": "ORDER_001",
//	    "amount":          "128.50",
//	    "subject":         "会员年卡",
//	    "tradeType":       "NATIVE",
//	})
//
// 约定：
//   - 金额一律字符串（元，两位小数），禁止浮点运算
//   - 所有写接口带幂等键（merchantOrderNo / merchantRefundNo），重试安全
//   - code != 0 返回 *PayError（含 Code / TraceID）
package payclient

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 开放接口路径
const (
	PathPayCreate    = "/api/v1/open/pay/create"
	PathPayQuery     = "/api/v1/open/pay/query"
	PathPayClose     = "/api/v1/open/pay/close"
	PathPayChannels  = "/api/v1/open/pay/channels"
	// ChannelAuto 渠道自动路由：不传 channel 时由支付中心自动选择，新增渠道无需升级 SDK
	ChannelAuto = "auto"
	PathRefundCreate = "/api/v1/open/refund/create"
	PathRefundQuery  = "/api/v1/open/refund/query"
)

// Client 支付中心客户端
type Client struct {
	BaseURL   string
	AppID     string
	AppSecret string
	Timeout   time.Duration
	// 如需自定义代理 / 连接池，可替换该字段
	HTTPClient *http.Client
}

// New 创建客户端，默认超时 10 秒
func New(baseURL, appID, appSecret string) *Client {
	return &Client{
		BaseURL:   strings.TrimRight(baseURL, "/"),
		AppID:     appID,
		AppSecret: appSecret,
		Timeout:   10 * time.Second,
	}
}

// PayError 支付中心返回的业务错误（code != 0）
type PayError struct {
	Code    int
	Message string
	TraceID string
}

func (e *PayError) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

// ==================== 开放接口 ====================

// CreateOrder 下单（幂等：同一 merchantOrderNo 返回同一订单）；未指定 channel 时由服务端路由
func (c *Client) CreateOrder(params map[string]any) (map[string]any, error) {
	body := make(map[string]any, len(params)+1)
	for k, v := range params {
		body[k] = v
	}
	if _, ok := body["channel"]; !ok {
		body["channel"] = ChannelAuto
	}
	return c.post(PathPayCreate, body)
}

// ListChannels 查询当前应用可用渠道，新增渠道会自动出现，无需升级 SDK
func (c *Client) ListChannels() (map[string]any, error) {
	return c.post(PathPayChannels, map[string]any{"appId": c.AppID})
}

// QueryOrder 查单：{"payOrderNo": ...} 或 {"merchantOrderNo": ...}
func (c *Client) QueryOrder(params map[string]any) (map[string]any, error) {
	return c.post(PathPayQuery, params)
}

// CloseOrder 关闭未支付订单
func (c *Client) CloseOrder(payOrderNo string) (map[string]any, error) {
	return c.post(PathPayClose, map[string]any{"payOrderNo": payOrderNo})
}

// Refund 退款（幂等键 merchantRefundNo）
func (c *Client) Refund(params map[string]any) (map[string]any, error) {
	return c.post(PathRefundCreate, params)
}

// QueryRefund 查退款：{"refundNo": ...} 或 {"merchantRefundNo": ...}
func (c *Client) QueryRefund(params map[string]any) (map[string]any, error) {
	return c.post(PathRefundQuery, params)
}

// ==================== 通知验签 ====================

// VerifyNotify 校验支付中心推送的通知签名（务必在业务落库前校验）
// headers 为原始请求头（key 大小写不敏感），rawBody 为未经解析的原始 body 字符串
func (c *Client) VerifyNotify(headers map[string]string, rawBody string) bool {
	ts := header(headers, "x-pay-timestamp")
	nonce := header(headers, "x-pay-nonce")
	sign := header(headers, "x-pay-sign")
	if ts == "" || nonce == "" || sign == "" {
		return false
	}
	appID := header(headers, "x-pay-app-id")
	if appID == "" {
		appID = c.AppID
	}

	sum := sha256.Sum256([]byte(rawBody))
	content := strings.Join([]string{appID, ts, nonce, hex.EncodeToString(sum[:])}, "\n")
	expected := c.hmacSha256Hex(content)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(sign))) == 1
}

// ==================== 签名 ====================

// BuildSignHeaders 构造签名请求头
// 待签串 = appId \n timestamp \n nonce \n METHOD \n path \n sha256(body)
func (c *Client) BuildSignHeaders(method, path, body string) map[string]string {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := randomHex(12)
	sum := sha256.Sum256([]byte(body))
	content := strings.Join([]string{
		c.AppID, timestamp, nonce, strings.ToUpper(method), path, hex.EncodeToString(sum[:]),
	}, "\n")

	return map[string]string{
		"X-App-Id":    c.AppID,
		"X-Timestamp": timestamp,
		"X-Nonce":     nonce,
		"X-Sign":      c.hmacSha256Hex(content),
	}
}

// ==================== 内部实现 ====================

func (c *Client) post(path string, payload map[string]any) (map[string]any, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	if _, ok := payload["appId"]; !ok {
		payload["appId"] = c.AppID
	}
	// 参与签名与发送的必须是同一份字节
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, &PayError{Code: -1, Message: "请求体序列化失败：" + err.Error()}
	}

	req, err := http.NewRequest(http.MethodPost, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, &PayError{Code: -1, Message: "构造请求失败：" + err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range c.BuildSignHeaders(http.MethodPost, path, string(body)) {
		req.Header.Set(k, v)
	}

	resp, err := c.http().Do(req)
	if err != nil {
		return nil, &PayError{Code: -1, Message: "请求支付中心失败：" + err.Error()}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &PayError{Code: -1, Message: "读取响应失败：" + err.Error()}
	}

	var out struct {
		Code    int            `json:"code"`
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
		TraceID string         `json:"traceId"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, &PayError{Code: -1, Message: "响应解析失败：" + string(raw)}
	}
	if out.Code != 0 {
		return nil, &PayError{Code: out.Code, Message: out.Message, TraceID: out.TraceID}
	}
	if out.Data == nil {
		out.Data = map[string]any{}
	}
	return out.Data, nil
}

func (c *Client) http() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &http.Client{Timeout: timeout}
}

func (c *Client) hmacSha256Hex(content string) string {
	mac := hmac.New(sha256.New, []byte(c.AppSecret))
	mac.Write([]byte(content))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buf)
}

func header(headers map[string]string, lowerName string) string {
	if v, ok := headers[lowerName]; ok {
		return v
	}
	for k, v := range headers {
		if strings.EqualFold(k, lowerName) {
			return v
		}
	}
	return ""
}
