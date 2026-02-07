from pydantic import BaseModel

from app.schemas.user import UserResponse


class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token from frontend


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    user: UserResponse
