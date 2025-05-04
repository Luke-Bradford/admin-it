# backend/app/models.py

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import declarative_base, relationship

# Declare your ORM base here — only once!
Base = declarative_base()


class CoreConnection(Base):
    __tablename__ = "CoreConnections"
    __table_args__ = {"schema": None}  # we'll format schema in DDL scripts

    Id           = Column(Integer, primary_key=True, autoincrement=True)
    Name         = Column(String(100), nullable=False, unique=True)
    Host         = Column(String(200), nullable=False)
    Port         = Column(Integer, default=1433, nullable=False)
    Username     = Column(String(100), nullable=False)
    PasswordEnc  = Column(Text, nullable=False)
    DatabaseName = Column(String(100), nullable=False)
    SchemaName   = Column(String(100), default="adm", nullable=False)
    Driver       = Column(String(100), default="ODBC Driver 17 for SQL Server", nullable=False)
    CreatedAt    = Column(DateTime, default=datetime.utcnow, nullable=False)
    UpdatedAt    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    CreatedBy    = Column(Integer, nullable=True)
    UpdatedBy    = Column(Integer, nullable=True)

    permissions = relationship("Permission", back_populates="connection")


class SystemUser(Base):
    __tablename__ = "SystemUsers"
    __table_args__ = {"schema": None}

    Id         = Column(Integer, primary_key=True, autoincrement=True)
    Name       = Column(String(100), nullable=False)
    Email      = Column(String(200), nullable=False, unique=True)
    IsActive   = Column(Boolean, default=True, nullable=False)
    CreatedAt  = Column(DateTime, default=datetime.utcnow, nullable=False)
    UpdatedAt  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    CreatedBy  = Column(Integer, nullable=True)
    UpdatedBy  = Column(Integer, nullable=True)

    permissions = relationship("Permission", back_populates="user")


class Permission(Base):
    __tablename__ = "Permissions"
    __table_args__ = {"schema": None}

    Id            = Column(Integer, primary_key=True, autoincrement=True)
    UserId        = Column(Integer, ForeignKey("SystemUsers.Id"), nullable=False)
    ConnectionId  = Column(Integer, ForeignKey("CoreConnections.Id"), nullable=True)
    PageName      = Column(String(200), nullable=True)
    CanRead       = Column(Boolean, default=False, nullable=False)
    CanWrite      = Column(Boolean, default=False, nullable=False)
    CreatedAt     = Column(DateTime, default=datetime.utcnow, nullable=False)

    user       = relationship("SystemUser", back_populates="permissions")
    connection = relationship("CoreConnection", back_populates="permissions")
