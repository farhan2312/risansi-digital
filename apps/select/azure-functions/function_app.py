import json
import logging
import uuid
from datetime import date, datetime
from decimal import Decimal

import azure.functions as func
import bcrypt
from sqlalchemy import func as sql_func, select

from shared.auth import AuthError, create_token, decode_token, require_admin
from shared.database import SessionLocal
from shared.models import (
    MotorMasterRow,
    Project,
    PumpModelMaster,
    PumpRecommendation,
    PumpSelection,
    PumpTestReport,
    PumpTestReportPoint,
    SealChartRow,
    SuctionVelocityRow,
    TestRequisition,
    User,
    VECorrectionRow,
)
from shared.recommendation_engine import (
    build_selection_report,
    find_candidates,
    resolve_drive,
    resolve_moc,
    resolve_sealing,
    size_suction_discharge,
    to_cp,
    to_m3_per_hr,
    to_mwc,
)

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


def _json_default(value):
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _row_to_dict(row) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


def _user_to_dict(user) -> dict:
    data = _row_to_dict(user)
    data.pop("password_hash", None)
    return data


def _json_response(data, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(data, default=_json_default),
        status_code=status_code,
        mimetype="application/json",
    )


@app.route(route="health", methods=["GET"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    return _json_response({"status": "ok"})


@app.route(route="projects", methods=["GET"])
def list_projects(req: func.HttpRequest) -> func.HttpResponse:
    with SessionLocal() as db:
        rows = db.scalars(select(Project).order_by(Project.created_at.desc())).all()
        return _json_response([_row_to_dict(r) for r in rows])


@app.route(route="projects", methods=["POST"])
def create_project(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    name = body.get("name")
    if not name:
        return _json_response({"error": "'name' is required"}, status_code=400)

    with SessionLocal() as db:
        count = db.query(Project).count()
        project = Project(
            project_code=f"PRJ-{count + 1:03d}",
            name=name,
            customer_name=body.get("customer"),
            industry=body.get("industry"),
            remarks=body.get("remarks"),
            client_code=body.get("clientCode", "Pending"),
            status=body.get("status", "In Progress"),
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        return _json_response(_row_to_dict(project), status_code=201)


@app.route(route="masters", methods=["GET"])
def get_masters(req: func.HttpRequest) -> func.HttpResponse:
    with SessionLocal() as db:
        data = {
            "pumpModels": [_row_to_dict(r) for r in db.scalars(select(PumpModelMaster)).all()],
            "veCorrection": [_row_to_dict(r) for r in db.scalars(select(VECorrectionRow)).all()],
            "motors": [_row_to_dict(r) for r in db.scalars(select(MotorMasterRow)).all()],
            "suctionVelocity": [_row_to_dict(r) for r in db.scalars(select(SuctionVelocityRow)).all()],
            "mechanicalSeal": [_row_to_dict(r) for r in db.scalars(select(SealChartRow)).all()],
        }
        return _json_response(data)


def _to_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@app.route(route="recommendations", methods=["POST"])
def get_recommendations(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    sg = _to_float(body.get("sg"), 1.0) or 1.0
    capacity_raw = _to_float(body.get("capacity"))
    head_raw = _to_float(body.get("head"))
    viscosity_raw = _to_float(body.get("viscosity"))
    temperature = _to_float(body.get("temperature"))
    solid_pct = _to_float(body.get("solidPercentage"))
    motor_rpm = _to_float(body.get("motorRPM"), 0) or None

    if capacity_raw <= 0 or head_raw <= 0:
        return _json_response({"error": "'capacity' and 'head' are required and must be > 0"}, status_code=400)

    capacity_m3hr = to_m3_per_hr(capacity_raw, body.get("capacityUnit"), sg)
    head_mwc = to_mwc(head_raw, body.get("headUnit"), sg)
    viscosity_cp = to_cp(viscosity_raw, body.get("viscosityUnit"), sg)

    with SessionLocal() as db:
        candidates = find_candidates(db, capacity_m3hr, head_mwc, viscosity_cp, solid_pct, motor_rpm)[:5]

        moc = resolve_moc(db, body.get("media", ""), temperature, solid_pct)
        moc_str = ", ".join(filter(None, [
            f"Casing: {moc.casing}" if moc.casing else None,
            f"Rotor: {moc.rotor}" if moc.rotor else None,
            f"Stator: {moc.stator}" if moc.stator else None,
        ])) or None

        hazardous = "chemical" in (body.get("media", "").lower()) or "acid" in (body.get("media", "").lower())
        high_pressure = head_mwc > 60
        sealing_type = resolve_sealing(db, body.get("sealingType"), hazardous, high_pressure)

        suction_nb, discharge_nb, media_velocity_class = size_suction_discharge(
            db, capacity_m3hr, viscosity_cp, solid_pct
        )

        selection = PumpSelection(
            project_id=body.get("projectId"),
            project_name=body.get("projectName"), customer_name=body.get("customerName"),
            capacity=body.get("capacity"), capacity_unit=body.get("capacityUnit"),
            head=body.get("head"), head_unit=body.get("headUnit"),
            media=body.get("media"), temperature=body.get("temperature"),
            sg=body.get("sg"), ph=body.get("ph"),
            viscosity=body.get("viscosity"), viscosity_unit=body.get("viscosityUnit"),
            viscosity_range=body.get("viscosityRange"),
            solid_percentage=body.get("solidPercentage"), solid_size=body.get("solidSize"),
            pump_type=body.get("pumpType"), bearing_housing=body.get("bearingHousing"),
            suction_housing=body.get("suctionHousing"), joint_type=body.get("jointType"),
            drive_system=body.get("driveSystem"), sealing_type=body.get("sealingType"),
            motor_make=body.get("motorMake"), gearbox_make=body.get("gearboxMake"),
            motor_rpm=body.get("motorRPM"),
        )
        db.add(selection)
        db.flush()

        results = []
        for i, c in enumerate(candidates):
            drive = resolve_drive(c.rpm_required, motor_rpm)
            rec = PumpRecommendation(
                selection_id=selection.id, model=c.model,
                rpm=f"{c.rpm_required:.0f}", flow=f"{capacity_raw} {body.get('capacityUnit', '')}".strip(),
                head=f"{head_raw} {body.get('headUnit', '')}".strip(),
                bearing_housing=body.get("bearingHousing"), suction_housing=body.get("suctionHousing"),
                joint_type=body.get("jointType"), sealing_type=sealing_type, moc=moc_str,
                suction_size=f"{suction_nb} NB", delivery_size=f"{discharge_nb} NB",
                motor=f"{c.installed_kw:.2f} kW" if c.installed_kw else None,
                drive_system=drive, score=f"{c.score:.0f}",
                availability="Unknown", tested="Yes" if c.is_tested else "No",
                report_no=None, rejection_reasons=c.rejection_reasons or None,
            )
            db.add(rec)
            db.flush()
            results.append({
                "id": i,
                "recommendationId": str(rec.id),
                "model": rec.model, "rpm": rec.rpm, "flow": rec.flow, "head": rec.head,
                "bearingHousing": rec.bearing_housing, "suctionHousing": rec.suction_housing,
                "jointType": rec.joint_type, "sealingType": rec.sealing_type, "moc": rec.moc,
                "suctionSize": rec.suction_size, "deliverySize": rec.delivery_size,
                "motor": rec.motor, "driveSystem": rec.drive_system, "score": rec.score,
                "availability": rec.availability, "tested": rec.tested, "reportNo": rec.report_no,
                "rejectionReasons": rec.rejection_reasons,
                "dataSource": {"performanceCurve": "tested" if c.is_tested else "calculated", "kw": c.kw_source},
            })

        db.commit()
        return _json_response({"selectionId": str(selection.id), "recommendations": results})


@app.route(route="recommendations/{recommendation_id}/report", methods=["GET"])
def get_selection_report(req: func.HttpRequest) -> func.HttpResponse:
    recommendation_id = req.route_params.get("recommendation_id")
    try:
        rec_uuid = uuid.UUID(recommendation_id)
    except (TypeError, ValueError):
        return _json_response({"error": "Invalid recommendation id"}, status_code=400)

    with SessionLocal() as db:
        recommendation = db.get(PumpRecommendation, rec_uuid)
        if recommendation is None:
            return _json_response({"error": "Recommendation not found"}, status_code=404)

        selection = db.get(PumpSelection, recommendation.selection_id) if recommendation.selection_id else None
        if selection is None:
            return _json_response({"error": "Parent selection not found"}, status_code=404)

        report = build_selection_report(db, recommendation, selection)
        return _json_response(report)


@app.route(route="pump-selections", methods=["POST"])
def create_pump_selection(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    known_fields = {c.name for c in PumpSelection.__table__.columns}
    payload = {k: v for k, v in body.items() if k in known_fields}

    with SessionLocal() as db:
        selection = PumpSelection(**payload)
        db.add(selection)
        db.commit()
        db.refresh(selection)
        return _json_response(_row_to_dict(selection), status_code=201)


# ---------------------------------------------------------------------------
# Testing portal: requisitions and detailed test reports
# ---------------------------------------------------------------------------


def _parse_date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except (TypeError, ValueError):
        return None


@app.route(route="requisitions", methods=["GET"])
def list_requisitions(req: func.HttpRequest) -> func.HttpResponse:
    status = req.params.get("status")
    with SessionLocal() as db:
        stmt = select(TestRequisition).order_by(TestRequisition.created_at.desc())
        if status:
            stmt = stmt.where(TestRequisition.status == status)
        rows = db.scalars(stmt).all()
        return _json_response([_row_to_dict(r) for r in rows])


@app.route(route="requisitions", methods=["POST"])
def create_requisition(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    model = body.get("model")
    if not model:
        return _json_response({"error": "'model' is required"}, status_code=400)

    known_fields = {c.name for c in TestRequisition.__table__.columns}
    payload = {k: v for k, v in body.items() if k in known_fields and k not in ("id", "status", "created_at", "updated_at", "closed_at")}
    if "date_of_receipt" in payload:
        payload["date_of_receipt"] = _parse_date(payload["date_of_receipt"])
    if "testing_plan_date" in payload:
        payload["testing_plan_date"] = _parse_date(payload["testing_plan_date"])
    if "date_of_testing" in payload:
        payload["date_of_testing"] = _parse_date(payload["date_of_testing"])

    with SessionLocal() as db:
        requisition = TestRequisition(**payload, status="Pending")
        db.add(requisition)
        db.commit()
        db.refresh(requisition)
        return _json_response(_row_to_dict(requisition), status_code=201)


@app.route(route="requisitions/{requisition_id}", methods=["GET"])
def get_requisition(req: func.HttpRequest) -> func.HttpResponse:
    try:
        req_uuid = uuid.UUID(req.route_params.get("requisition_id"))
    except (TypeError, ValueError):
        return _json_response({"error": "Invalid requisition id"}, status_code=400)

    with SessionLocal() as db:
        requisition = db.get(TestRequisition, req_uuid)
        if requisition is None:
            return _json_response({"error": "Requisition not found"}, status_code=404)
        data = _row_to_dict(requisition)
        reports = db.scalars(
            select(PumpTestReport).where(PumpTestReport.requisition_id == req_uuid)
        ).all()
        data["reports"] = [_row_to_dict(r) for r in reports]
        return _json_response(data)


@app.route(route="requisitions/{requisition_id}", methods=["PATCH"])
def update_requisition(req: func.HttpRequest) -> func.HttpResponse:
    try:
        req_uuid = uuid.UUID(req.route_params.get("requisition_id"))
    except (TypeError, ValueError):
        return _json_response({"error": "Invalid requisition id"}, status_code=400)

    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    known_fields = {c.name for c in TestRequisition.__table__.columns} - {"id", "created_at"}
    payload = {k: v for k, v in body.items() if k in known_fields}
    for date_field in ("date_of_receipt", "testing_plan_date", "date_of_testing"):
        if date_field in payload:
            payload[date_field] = _parse_date(payload[date_field])

    with SessionLocal() as db:
        requisition = db.get(TestRequisition, req_uuid)
        if requisition is None:
            return _json_response({"error": "Requisition not found"}, status_code=404)
        for key, value in payload.items():
            setattr(requisition, key, value)
        if payload.get("status") == "Closed" and requisition.closed_at is None:
            requisition.closed_at = datetime.utcnow()
        db.commit()
        db.refresh(requisition)
        return _json_response(_row_to_dict(requisition))


@app.route(route="requisitions/dedup-check", methods=["GET"])
def dedup_check(req: func.HttpRequest) -> func.HttpResponse:
    """Search prior test reports for a model, so the testing team can see whether
    it has already been tested before running a new test."""
    model = req.params.get("model")
    if not model:
        return _json_response({"error": "'model' query param is required"}, status_code=400)

    with SessionLocal() as db:
        reports = db.scalars(
            select(PumpTestReport)
            .where(PumpTestReport.model.ilike(model))
            .order_by(PumpTestReport.created_at.desc())
        ).all()

        report_ids = [r.id for r in reports]
        points_by_report: dict = {}
        for point in db.scalars(
            select(PumpTestReportPoint).where(PumpTestReportPoint.report_id.in_(report_ids))
        ).all():
            points_by_report.setdefault(point.report_id, []).append(point)

        results = []
        for report in reports:
            data = _row_to_dict(report)
            data["points"] = [_row_to_dict(p) for p in points_by_report.get(report.id, [])]
            results.append(data)
        return _json_response({"model": model, "priorReports": results, "alreadyTested": len(results) > 0})


@app.route(route="reports", methods=["GET"])
def list_reports(req: func.HttpRequest) -> func.HttpResponse:
    """Browse/search all reports (historical imports + ones submitted through
    the app). Optional 'model' query param filters by substring match."""
    model = req.params.get("model")
    limit = min(int(req.params.get("limit", 200)), 500)

    with SessionLocal() as db:
        stmt = select(PumpTestReport).order_by(PumpTestReport.created_at.desc()).limit(limit)
        if model:
            stmt = stmt.where(PumpTestReport.model.ilike(f"%{model}%"))
        reports = db.scalars(stmt).all()

        report_ids = [r.id for r in reports]
        point_counts = dict(
            db.execute(
                select(PumpTestReportPoint.report_id, sql_func.count(PumpTestReportPoint.id))
                .where(PumpTestReportPoint.report_id.in_(report_ids))
                .group_by(PumpTestReportPoint.report_id)
            ).all()
        )

        results = []
        for report in reports:
            data = _row_to_dict(report)
            data["pointCount"] = point_counts.get(report.id, 0)
            results.append(data)
        return _json_response(results)


@app.route(route="reports", methods=["POST"])
def create_report(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    model = body.get("model")
    if not model:
        return _json_response({"error": "'model' is required"}, status_code=400)

    requisition_id = body.get("requisitionId")
    req_uuid = None
    if requisition_id:
        try:
            req_uuid = uuid.UUID(requisition_id)
        except (TypeError, ValueError):
            return _json_response({"error": "Invalid requisitionId"}, status_code=400)

    known_fields = {c.name for c in PumpTestReport.__table__.columns}
    payload = {k: v for k, v in body.items() if k in known_fields and k not in ("id", "created_at", "requisition_id")}
    if "test_date" in payload:
        payload["test_date"] = _parse_date(payload["test_date"])

    point_fields = {c.name for c in PumpTestReportPoint.__table__.columns} - {"id", "report_id"}
    points_payload = body.get("points") or []

    with SessionLocal() as db:
        if req_uuid is not None:
            requisition = db.get(TestRequisition, req_uuid)
            if requisition is None:
                return _json_response({"error": "Requisition not found"}, status_code=404)

        report = PumpTestReport(requisition_id=req_uuid, **payload)
        db.add(report)
        db.flush()

        for point in points_payload:
            point_data = {k: v for k, v in point.items() if k in point_fields}
            db.add(PumpTestReportPoint(report_id=report.id, **point_data))

        if req_uuid is not None:
            requisition.status = "Closed"
            requisition.closed_at = datetime.utcnow()

        db.commit()
        db.refresh(report)

        result = _row_to_dict(report)
        result["points"] = [
            _row_to_dict(p)
            for p in db.scalars(select(PumpTestReportPoint).where(PumpTestReportPoint.report_id == report.id)).all()
        ]
        return _json_response(result, status_code=201)


@app.route(route="reports/{report_id}", methods=["GET"])
def get_report(req: func.HttpRequest) -> func.HttpResponse:
    try:
        report_uuid = uuid.UUID(req.route_params.get("report_id"))
    except (TypeError, ValueError):
        return _json_response({"error": "Invalid report id"}, status_code=400)

    with SessionLocal() as db:
        report = db.get(PumpTestReport, report_uuid)
        if report is None:
            return _json_response({"error": "Report not found"}, status_code=404)
        data = _row_to_dict(report)
        data["points"] = [
            _row_to_dict(p)
            for p in db.scalars(
                select(PumpTestReportPoint).where(PumpTestReportPoint.report_id == report_uuid)
            ).all()
        ]
        return _json_response(data)


# ---------------------------------------------------------------------------
# Auth: access requests, login, admin approval
# ---------------------------------------------------------------------------


@app.route(route="access-requests", methods=["POST"])
def create_access_request(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not name or not email or not password:
        return _json_response({"error": "'name', 'email', and 'password' are required"}, status_code=400)

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.email == email))
        if existing is None:
            user = User(name=name, email=email, password_hash=password_hash, role="user", status="pending")
            db.add(user)
            db.commit()
            db.refresh(user)
            return _json_response(_user_to_dict(user), status_code=201)

        if existing.status == "pending":
            return _json_response({"error": "An access request for this email is already pending."}, status_code=409)
        if existing.status == "active":
            return _json_response({"error": "An account already exists for this email. Please log in."}, status_code=409)

        # status == "rejected" — allow resubmission
        existing.name = name
        existing.password_hash = password_hash
        existing.status = "pending"
        existing.reviewed_by = None
        existing.reviewed_at = None
        db.commit()
        db.refresh(existing)
        return _json_response(_user_to_dict(existing))


@app.route(route="auth/login", methods=["POST"])
def login(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        return _json_response({"error": "'email' and 'password' are required"}, status_code=400)

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None or not bcrypt.checkpw(password.encode(), user.password_hash.encode()):
            return _json_response({"error": "Invalid email or password."}, status_code=401)

        if user.status == "pending":
            return _json_response({"error": "Your access request is still pending admin approval."}, status_code=403)
        if user.status == "rejected":
            return _json_response({"error": "Your access request was rejected. Contact an administrator."}, status_code=403)

        token = create_token(user)
        return _json_response({
            "token": token,
            "user": {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role},
        })


@app.route(route="auth/change-password", methods=["POST"])
def change_password(req: func.HttpRequest) -> func.HttpResponse:
    try:
        claims = decode_token(req)
    except AuthError as e:
        return _json_response({"error": e.message}, status_code=e.status_code)

    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    current_password = body.get("currentPassword") or ""
    new_password = body.get("newPassword") or ""
    if not current_password or not new_password:
        return _json_response({"error": "'currentPassword' and 'newPassword' are required"}, status_code=400)

    with SessionLocal() as db:
        user = db.get(User, uuid.UUID(claims["sub"]))
        if user is None:
            return _json_response({"error": "User not found"}, status_code=404)
        if not bcrypt.checkpw(current_password.encode(), user.password_hash.encode()):
            return _json_response({"error": "Current password is incorrect."}, status_code=401)

        user.password_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        db.commit()
        return _json_response({"success": True})


@app.route(route="users", methods=["GET"])
def list_users(req: func.HttpRequest) -> func.HttpResponse:
    try:
        require_admin(req)
    except AuthError as e:
        return _json_response({"error": e.message}, status_code=e.status_code)

    status = req.params.get("status")
    with SessionLocal() as db:
        stmt = select(User).order_by(User.created_at.asc())
        if status:
            stmt = stmt.where(User.status == status)
        rows = db.scalars(stmt).all()
        return _json_response([_user_to_dict(u) for u in rows])


@app.route(route="users/{user_id}", methods=["PATCH"])
def review_user(req: func.HttpRequest) -> func.HttpResponse:
    # Note: route is /users, not /admin/users — the Azure Functions runtime
    # reserves the "admin/" path prefix for its own built-in host-management
    # API and refuses to register a route there ("conflicts with one or more
    # built in routes"). Admin-only enforcement instead comes entirely from
    # require_admin() below, not from the URL path.
    try:
        claims = require_admin(req)
    except AuthError as e:
        return _json_response({"error": e.message}, status_code=e.status_code)

    try:
        user_uuid = uuid.UUID(req.route_params.get("user_id"))
    except (TypeError, ValueError):
        return _json_response({"error": "Invalid user id"}, status_code=400)

    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body must be JSON"}, status_code=400)

    new_status = body.get("status")
    if new_status not in ("active", "rejected"):
        return _json_response({"error": "'status' must be 'active' or 'rejected'"}, status_code=400)

    with SessionLocal() as db:
        user = db.get(User, user_uuid)
        if user is None:
            return _json_response({"error": "User not found"}, status_code=404)
        if user.status != "pending":
            return _json_response({"error": "This request has already been reviewed."}, status_code=409)

        user.status = new_status
        user.reviewed_by = uuid.UUID(claims["sub"])
        user.reviewed_at = datetime.utcnow()
        db.commit()
        db.refresh(user)
        return _json_response(_user_to_dict(user))
