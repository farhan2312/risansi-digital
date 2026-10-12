import os
import time

import jwt

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 60 * 60 * 12  # 12 hours


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 401):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def create_token(user) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(req) -> dict:
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise AuthError("Missing or invalid Authorization header", 401)
    token = header[len("Bearer "):]
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise AuthError("Token expired", 401)
    except jwt.InvalidTokenError:
        raise AuthError("Invalid token", 401)


def require_admin(req) -> dict:
    payload = decode_token(req)
    if payload.get("role") != "admin":
        raise AuthError("Admin access required", 403)
    return payload
