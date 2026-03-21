# app/routes/manage_routes.py

from fastapi import APIRouter, Depends

from app.utils.auth_dependency import verify_token

router = APIRouter()


@router.get("/status")
def protected_status(user_id: str = Depends(verify_token)):
    return {"user": user_id, "message": "You are authenticated."}
