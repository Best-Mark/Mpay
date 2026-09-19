"""统一支付中心 · Python 接入 SDK（零依赖，仅用标准库 urllib，Python 3.8+）

用法：
    from pay_client import PayClient, PayError

    client = PayClient("https://pay.example.com", app_id, app_secret)
    order = client.create_order({
        "merchantOrderNo": "ORDER_001",
        "amount": "128.50",
        "subject": "会员年卡",
        "tradeType": "NATIVE",
    })

约定：
    - 金额一律字符串（元，两位小数），禁止浮点运算
    - 所有写接口带幂等键（merchantOrderNo / merchantRefundNo），重试安全
    - code != 0 抛出 PayError（含 code / trace_id）
"""

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Mapping, Optional


class PayError(Exception):
    """支付中心返回的业务异常（code != 0）"""

    def __init__(self, code: int, message: str, trace_id: Optional[str] = None):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.trace_id = trace_id


class PayClient:
    PATH_PAY_CREATE = "/api/v1/open/pay/create"
    PATH_PAY_QUERY = "/api/v1/open/pay/query"
    PATH_PAY_CLOSE = "/api/v1/open/pay/close"
    PATH_REFUND_CREATE = "/api/v1/open/refund/create"
    PATH_REFUND_QUERY = "/api/v1/open/refund/query"

    def __init__(self, base_url: str, app_id: str, app_secret: str, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.app_id = app_id
        self.app_secret = app_secret
        self.timeout = timeout

    # ==================== 开放接口 ====================

    def create_order(self, params: Mapping[str, Any]) -> Dict[str, Any]:
        """下单（幂等：同一 merchantOrderNo 返回同一订单）"""
        return self._post(self.PATH_PAY_CREATE, params)

    def query_order(self, params: Mapping[str, Any]) -> Dict[str, Any]:
        """查单：{"payOrderNo": ...} 或 {"merchantOrderNo": ...}"""
        return self._post(self.PATH_PAY_QUERY, params)

    def close_order(self, pay_order_no: str) -> Dict[str, Any]:
        """关闭未支付订单"""
        return self._post(self.PATH_PAY_CLOSE, {"payOrderNo": pay_order_no})

    def refund(self, params: Mapping[str, Any]) -> Dict[str, Any]:
        """退款（幂等键 merchantRefundNo）"""
        return self._post(self.PATH_REFUND_CREATE, params)

    def query_refund(self, params: Mapping[str, Any]) -> Dict[str, Any]:
        """查退款：{"refundNo": ...} 或 {"merchantRefundNo": ...}"""
        return self._post(self.PATH_REFUND_QUERY, params)

    # ==================== 通知验签 ====================

    def verify_notify(self, headers: Mapping[str, str], raw_body: str) -> bool:
        """校验支付中心推送的通知签名（务必在业务落库前校验）

        :param headers: 原始请求头（key 大小写不敏感）
        :param raw_body: 未经任何解析的原始 body 字符串
        """
        ts = self._header(headers, "x-pay-timestamp")
        nonce = self._header(headers, "x-pay-nonce")
        sign = self._header(headers, "x-pay-sign")
        app_id = self._header(headers, "x-pay-app-id") or self.app_id
        if not ts or not nonce or not sign:
            return False

        content = "\n".join([app_id, ts, nonce, self._sha256_hex(raw_body or "")])
        expected = self._hmac_sha256_hex(self.app_secret, content)
        return hmac.compare_digest(expected, sign.lower())

    # ==================== 签名 ====================

    def build_sign_headers(self, method: str, path: str, body: str) -> Dict[str, str]:
        """待签串 = appId \\n timestamp \\n nonce \\n METHOD \\n path \\n sha256(body)"""
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(12)
        content = "\n".join(
            [self.app_id, timestamp, nonce, method.upper(), path, self._sha256_hex(body)]
        )
        return {
            "X-App-Id": self.app_id,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Sign": self._hmac_sha256_hex(self.app_secret, content),
        }

    # ==================== 内部实现 ====================

    def _post(self, path: str, payload: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
        body_map: Dict[str, Any] = dict(payload or {})
        body_map.setdefault("appId", self.app_id)
        # 参与签名与发送的必须是同一个字符串
        body = json.dumps(body_map, ensure_ascii=False, separators=(",", ":"))

        req = urllib.request.Request(
            self.base_url + path,
            data=body.encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", **self.build_sign_headers("POST", path, body)},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "ignore")
        except Exception as e:  # 网络层异常
            raise PayError(-1, f"请求支付中心失败：{e}")

        try:
            resp_json = json.loads(raw)
        except Exception:
            raise PayError(-1, f"响应解析失败：{raw}")

        code = int(resp_json.get("code", -1))
        if code != 0:
            raise PayError(code, resp_json.get("message", "支付中心返回失败"), resp_json.get("traceId"))
        data = resp_json.get("data")
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _header(headers: Mapping[str, str], lower_name: str) -> str:
        if headers is None:
            return ""
        for k, v in headers.items():
            if isinstance(k, str) and k.lower() == lower_name:
                return str(v or "")
        return ""

    @staticmethod
    def _sha256_hex(s: str) -> str:
        return hashlib.sha256(s.encode("utf-8")).hexdigest()

    @staticmethod
    def _hmac_sha256_hex(key: str, msg: str) -> str:
        return hmac.new(key.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()
