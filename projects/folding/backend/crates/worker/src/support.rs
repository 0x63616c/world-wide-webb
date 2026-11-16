//! Shared Worker primitives: the public failure catalog, request decoding, D1 bindings and responses.
use serde::Serialize;
use wasm_bindgen::{JsCast, JsValue};
use worker::*;

pub struct Failure {
    pub status: u16,
    pub code: &'static str,
    pub retryable: bool,
}
impl Failure {
    pub(crate) fn unavailable() -> Self {
        Self {
            status: 503,
            code: "temporarily_unavailable",
            retryable: true,
        }
    }
    pub(crate) fn unauthorized() -> Self {
        Self {
            status: 401,
            code: "authentication_required",
            retryable: false,
        }
    }
    pub(crate) fn malformed() -> Self {
        Self {
            status: 422,
            code: "invalid_input",
            retryable: false,
        }
    }
    pub(crate) fn conflict() -> Self {
        Self {
            status: 409,
            code: "conflict",
            retryable: true,
        }
    }
}
pub(crate) fn decode<T: serde::de::DeserializeOwned>(
    body: &[u8],
) -> std::result::Result<T, Failure> {
    serde_json::from_slice(body).map_err(|error| {
        if error.is_syntax() || error.is_eof() {
            Failure {
                status: 400,
                code: "malformed_request",
                retryable: false,
            }
        } else {
            Failure::malformed()
        }
    })
}
pub(crate) fn blob(bytes: &[u8]) -> JsValue {
    js_sys::Uint8Array::from(bytes).into()
}
pub(crate) fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}
pub(crate) fn number(value: i64) -> JsValue {
    JsValue::from_f64(value as f64)
}
pub(crate) fn now() -> i64 {
    js_sys::Date::now() as i64
}
pub(crate) fn random<const N: usize>() -> std::result::Result<[u8; N], Failure> {
    let scope = js_sys::global().unchecked_into::<web_sys::WorkerGlobalScope>();
    let mut bytes = [0; N];
    scope
        .crypto()
        .map_err(|_| Failure::unavailable())?
        .get_random_values_with_u8_array(&mut bytes)
        .map_err(|_| Failure::unavailable())?;
    Ok(bytes)
}
pub(crate) fn uuid() -> std::result::Result<String, Failure> {
    let scope = js_sys::global().unchecked_into::<web_sys::WorkerGlobalScope>();
    Ok(scope
        .crypto()
        .map_err(|_| Failure::unavailable())?
        .random_uuid())
}
pub(crate) fn statement(
    db: &D1Database,
    sql: &str,
    args: &[JsValue],
) -> std::result::Result<D1PreparedStatement, Failure> {
    db.prepare(sql)
        .bind(args)
        .map_err(|_| Failure::unavailable())
}
pub(crate) fn response(value: &impl Serialize) -> std::result::Result<Response, Failure> {
    let mut out = Response::from_json(value).map_err(|_| Failure::unavailable())?;
    out.headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    out.headers_mut()
        .set("X-Content-Type-Options", "nosniff")
        .map_err(|_| Failure::unavailable())?;
    Ok(out)
}
