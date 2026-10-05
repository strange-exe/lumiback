"""Request/response models. Inputs forbid unknown fields so typos fail loudly."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, model_validator

from app.security.passwords import MAX_LENGTH, password_problem

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
OptionalShort = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterIn(Input):
    name: Name
    email: EmailStr
    password: str = Field(max_length=MAX_LENGTH)  # never stripped or altered
    roll_no: Annotated[OptionalShort, StringConstraints(max_length=32)] | None = None
    hostel: OptionalShort | None = None

    @model_validator(mode="after")
    def _normalize_and_check(self) -> "RegisterIn":
        self.email = self.email.lower()
        if problem := password_problem(self.password, email=self.email, name=self.name):
            raise ValueError(f"password {problem}")
        return self


class LoginIn(Input):
    email: EmailStr
    password: str = Field(max_length=1024)


class RefreshIn(Input):
    refresh_token: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int
    refresh_token: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    hostel: str | None
    created_at: datetime
