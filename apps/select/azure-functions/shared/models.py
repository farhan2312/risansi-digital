import uuid
from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# Plain read/write mapping of the live Postgres schema — this project only
# queries the DB, it does not run migrations against it. (The old backend/
# folder held the Alembic migration history for this schema; it was removed
# since it was never deployed — see git history if migrations are needed
# again.)


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="user")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_name: Mapped[str | None] = mapped_column(String(255))
    client_code: Mapped[str | None] = mapped_column(String(100))
    industry: Mapped[str | None] = mapped_column(String(255))
    remarks: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="In Progress")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )


class PumpModelMaster(Base):
    __tablename__ = "pump_model_master"

    model: Mapped[str] = mapped_column(String(100), primary_key=True)
    pump_family: Mapped[str] = mapped_column(String(20), default="PCP")
    capacity_min: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    capacity_max: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    head_min: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    head_max: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    rpm_min: Mapped[int | None] = mapped_column(nullable=True)
    rpm_max: Mapped[int | None] = mapped_column(nullable=True)
    max_solid_pct: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    q_theoretical: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    min_kw_tested: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    min_kw_calculated: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    min_kw_source: Mapped[str | None] = mapped_column(String(20), nullable=True)


class PerformanceCurvePoint(Base):
    __tablename__ = "performance_curve"

    id: Mapped[uuid.UUID] = _uuid_pk()
    model: Mapped[str] = mapped_column(ForeignKey("pump_model_master.model"), nullable=False)
    pump_family: Mapped[str] = mapped_column(String(20), default="PCP")
    head_mwc: Mapped[float] = mapped_column(Numeric(10, 2))
    # Percentages (0-100), not 0-1 fractions — matches the source sheet.
    ve_min: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    ve_max: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    mech_efficiency: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    is_tested: Mapped[bool] = mapped_column(Boolean, default=False)


class VECorrectionRow(Base):
    __tablename__ = "ve_correction"

    id: Mapped[uuid.UUID] = _uuid_pk()
    pump_family: Mapped[str] = mapped_column(String(20), default="PCP")
    viscosity_min: Mapped[float] = mapped_column(Numeric(12, 2))
    viscosity_max: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    ve_correction: Mapped[float] = mapped_column(Numeric(6, 4))


class MotorMasterRow(Base):
    __tablename__ = "motor_master"

    id: Mapped[uuid.UUID] = _uuid_pk()
    kw: Mapped[float] = mapped_column(Numeric(10, 2))
    hp: Mapped[float] = mapped_column(Numeric(10, 2))
    rpm: Mapped[int] = mapped_column()


class SuctionVelocityRow(Base):
    __tablename__ = "suction_velocity"

    id: Mapped[uuid.UUID] = _uuid_pk()
    media_type: Mapped[str] = mapped_column(String(50))
    recommended_velocity: Mapped[float] = mapped_column(Numeric(6, 2))


class SealChartRow(Base):
    __tablename__ = "mechanical_seal_chart"

    id: Mapped[uuid.UUID] = _uuid_pk()
    media: Mapped[str] = mapped_column(String(255))
    seal_type: Mapped[str] = mapped_column(String(255))


class MocMaster(Base):
    __tablename__ = "moc_master"

    moc_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    pump_housing: Mapped[str | None] = mapped_column(String(100))
    shaft: Mapped[str | None] = mapped_column(String(100))
    rotor: Mapped[str | None] = mapped_column(String(100))
    c_rod: Mapped[str | None] = mapped_column(String(100))
    shd: Mapped[str | None] = mapped_column(String(100))
    slv: Mapped[str | None] = mapped_column(String(100))
    bush: Mapped[str | None] = mapped_column(String(100))
    h_pin: Mapped[str | None] = mapped_column(String(100))
    pin: Mapped[str | None] = mapped_column(String(100))
    protector: Mapped[str | None] = mapped_column(String(100))
    holder: Mapped[str | None] = mapped_column(String(100))
    stator_rubber: Mapped[str | None] = mapped_column(String(100))


class MocSelectionGuide(Base):
    __tablename__ = "moc_selection_guide"

    id: Mapped[uuid.UUID] = _uuid_pk()
    service_type: Mapped[str] = mapped_column(String(100))
    casing_moc: Mapped[str | None] = mapped_column(String(255))
    rotor_moc: Mapped[str | None] = mapped_column(String(255))
    stator_material: Mapped[str | None] = mapped_column(String(255))


class SealingSelectionRule(Base):
    __tablename__ = "sealing_selection_rule"

    id: Mapped[uuid.UUID] = _uuid_pk()
    condition: Mapped[str] = mapped_column(String(255))
    recommendation: Mapped[str] = mapped_column(String(20))


class SealFaceMaterialGuide(Base):
    __tablename__ = "seal_face_material_guide"

    id: Mapped[uuid.UUID] = _uuid_pk()
    service: Mapped[str] = mapped_column(String(100))
    face_combination: Mapped[str] = mapped_column(String(100))


class DriveSelectionMatrix(Base):
    __tablename__ = "drive_selection_matrix"

    id: Mapped[uuid.UUID] = _uuid_pk()
    condition: Mapped[str] = mapped_column(String(255))
    direct_drive: Mapped[str] = mapped_column(String(5))
    v_belt_drive: Mapped[str] = mapped_column(String(5))
    geared_motor: Mapped[str] = mapped_column(String(30))


class PulleySelection(Base):
    __tablename__ = "pulley_selection"

    id: Mapped[uuid.UUID] = _uuid_pk()
    motor_hp: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    motor_kw: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    target_rpm_band: Mapped[int] = mapped_column()
    groove_type: Mapped[str | None] = mapped_column(String(10))
    pump_pulley: Mapped[str | None] = mapped_column(String(20))
    motor_pulley: Mapped[str | None] = mapped_column(String(20))


class StandardMotorKw(Base):
    __tablename__ = "standard_motor_kw"

    kw: Mapped[float] = mapped_column(Numeric(10, 2), primary_key=True)


class RpmBandMaster(Base):
    __tablename__ = "rpm_band_master"

    id: Mapped[uuid.UUID] = _uuid_pk()
    application_class: Mapped[str] = mapped_column(String(255))
    viscosity_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    viscosity_max: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_solid_pct: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    rpm_min: Mapped[int] = mapped_column()
    rpm_max: Mapped[int] = mapped_column()


class PumpSelection(Base):
    __tablename__ = "pump_selections"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id"))

    project_name: Mapped[str | None] = mapped_column(String(255))
    customer_name: Mapped[str | None] = mapped_column(String(255))

    capacity: Mapped[str | None] = mapped_column(String(50))
    capacity_unit: Mapped[str | None] = mapped_column(String(20))
    head: Mapped[str | None] = mapped_column(String(50))
    head_unit: Mapped[str | None] = mapped_column(String(20))

    media: Mapped[str | None] = mapped_column(String(255))
    temperature: Mapped[str | None] = mapped_column(String(50))
    sg: Mapped[str | None] = mapped_column(String(50))
    ph: Mapped[str | None] = mapped_column(String(50))
    viscosity: Mapped[str | None] = mapped_column(String(50))
    viscosity_unit: Mapped[str | None] = mapped_column(String(20))
    viscosity_range: Mapped[str | None] = mapped_column(String(50))
    solid_percentage: Mapped[str | None] = mapped_column(String(50))
    solid_size: Mapped[str | None] = mapped_column(String(50))

    pump_type: Mapped[str | None] = mapped_column(String(100))
    bearing_housing: Mapped[str | None] = mapped_column(String(100))
    suction_housing: Mapped[str | None] = mapped_column(String(100))
    joint_type: Mapped[str | None] = mapped_column(String(100))
    drive_system: Mapped[str | None] = mapped_column(String(100))
    sealing_type: Mapped[str | None] = mapped_column(String(100))
    motor_make: Mapped[str | None] = mapped_column(String(100))
    gearbox_make: Mapped[str | None] = mapped_column(String(100))
    motor_rpm: Mapped[str | None] = mapped_column(String(50))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class PumpRecommendation(Base):
    __tablename__ = "pump_recommendations"

    id: Mapped[uuid.UUID] = _uuid_pk()
    selection_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("pump_selections.id"))

    model: Mapped[str] = mapped_column(String(100))
    rpm: Mapped[str | None] = mapped_column(String(50))
    flow: Mapped[str | None] = mapped_column(String(50))
    head: Mapped[str | None] = mapped_column(String(50))
    bearing_housing: Mapped[str | None] = mapped_column(String(100))
    suction_housing: Mapped[str | None] = mapped_column(String(100))
    joint_type: Mapped[str | None] = mapped_column(String(100))
    sealing_type: Mapped[str | None] = mapped_column(String(100))
    moc: Mapped[str | None] = mapped_column(String(100))
    suction_size: Mapped[str | None] = mapped_column(String(50))
    delivery_size: Mapped[str | None] = mapped_column(String(50))
    motor: Mapped[str | None] = mapped_column(String(100))
    drive_system: Mapped[str | None] = mapped_column(String(100))
    score: Mapped[str | None] = mapped_column(String(20))
    availability: Mapped[str | None] = mapped_column(String(50))
    tested: Mapped[str | None] = mapped_column(String(50))
    report_no: Mapped[str | None] = mapped_column(String(100))
    rejection_reasons: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class TestReport(Base):
    __tablename__ = "test_reports"

    id: Mapped[uuid.UUID] = _uuid_pk()
    recommendation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("pump_recommendations.id"))

    report_no: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    flow: Mapped[str | None] = mapped_column(String(50))
    head: Mapped[str | None] = mapped_column(String(50))
    match_score: Mapped[str | None] = mapped_column(String(20))
    availability: Mapped[str | None] = mapped_column(String(50))
    testing_status: Mapped[str | None] = mapped_column(String(50))
    passed: Mapped[bool] = mapped_column(Boolean, default=True)

    tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class TestRequisition(Base):
    __tablename__ = "test_requisitions"

    id: Mapped[uuid.UUID] = _uuid_pk()

    model: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100))
    ec_quotation_no: Mapped[str | None] = mapped_column(String(100))
    responsible_person: Mapped[str | None] = mapped_column(String(100))
    source_team: Mapped[str | None] = mapped_column(String(50))
    date_of_receipt: Mapped[date | None] = mapped_column(Date)
    test_qty: Mapped[int | None] = mapped_column(Integer)

    qth: Mapped[float | None] = mapped_column(Numeric(10, 4))
    power_hp: Mapped[float | None] = mapped_column(Numeric(10, 2))
    power_kw: Mapped[float | None] = mapped_column(Numeric(10, 4))
    head_kgcm2: Mapped[float | None] = mapped_column(Numeric(10, 2))
    rpm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    req_capacity: Mapped[float | None] = mapped_column(Numeric(10, 4))

    observation: Mapped[str | None] = mapped_column(Text)
    ra_value: Mapped[float | None] = mapped_column(Numeric(10, 4))
    ve_rated_head: Mapped[float | None] = mapped_column(Numeric(6, 2))
    me_rated_head: Mapped[float | None] = mapped_column(Numeric(6, 2))
    measured_capacity: Mapped[float | None] = mapped_column(Numeric(10, 4))
    measured_head: Mapped[float | None] = mapped_column(Numeric(10, 2))
    measured_power: Mapped[float | None] = mapped_column(Numeric(10, 4))
    noise_jamming_other: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str | None] = mapped_column(Text)
    npsha: Mapped[float | None] = mapped_column(Numeric(10, 4))
    test_result: Mapped[str | None] = mapped_column(String(20))

    testing_plan_date: Mapped[date | None] = mapped_column(Date)
    date_of_testing: Mapped[date | None] = mapped_column(Date)
    retest_without_changing_die_pin: Mapped[bool | None] = mapped_column(Boolean)
    retest_needed: Mapped[bool | None] = mapped_column(Boolean)
    die_pin_rework: Mapped[bool | None] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(String(30), default="Pending")
    general_remarks: Mapped[str | None] = mapped_column(Text)
    action_remarks: Mapped[str | None] = mapped_column(Text)

    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PumpTestReport(Base):
    __tablename__ = "pump_test_reports"

    id: Mapped[uuid.UUID] = _uuid_pk()
    requisition_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("test_requisitions.id"))

    model: Mapped[str] = mapped_column(String(100), nullable=False)
    gearbox_no: Mapped[str | None] = mapped_column(String(255))
    gearbox_ratio: Mapped[str | None] = mapped_column(String(50))
    motor: Mapped[str | None] = mapped_column(String(100))
    motor_rpm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    suction_type: Mapped[str | None] = mapped_column(String(20))

    liquid: Mapped[str | None] = mapped_column(String(100), default="WATER")
    rated_capacity: Mapped[float | None] = mapped_column(Numeric(10, 4))
    rated_head: Mapped[float | None] = mapped_column(Numeric(10, 2))
    specific_gravity: Mapped[float | None] = mapped_column(Numeric(6, 3))
    viscosity_cps: Mapped[float | None] = mapped_column(Numeric(10, 2))
    k_for_given_cps: Mapped[float | None] = mapped_column(Numeric(10, 4))
    rated_rpm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    q_theoretical_100rev: Mapped[float | None] = mapped_column(Numeric(10, 4))
    calculated_head: Mapped[float | None] = mapped_column(Numeric(10, 2))

    tested_by: Mapped[str | None] = mapped_column(String(100))
    test_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    points: Mapped[list["PumpTestReportPoint"]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="PumpTestReportPoint.rpm"
    )


class PumpTestReportPoint(Base):
    __tablename__ = "pump_test_report_points"

    id: Mapped[uuid.UUID] = _uuid_pk()
    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pump_test_reports.id"), nullable=False)

    rpm: Mapped[float] = mapped_column(Numeric(10, 2))
    head_kgcm2: Mapped[float | None] = mapped_column(Numeric(10, 2))
    head_mwc: Mapped[float | None] = mapped_column(Numeric(10, 2))
    vnotch_height: Mapped[float | None] = mapped_column(Numeric(10, 4))
    initial_reading: Mapped[float | None] = mapped_column(Numeric(10, 4))
    differential_height: Mapped[float | None] = mapped_column(Numeric(10, 4))
    capacity_calculated_m3hr: Mapped[float | None] = mapped_column(Numeric(10, 4))
    volts: Mapped[float | None] = mapped_column(Numeric(10, 2))
    amps: Mapped[float | None] = mapped_column(Numeric(10, 2))
    cos_phi: Mapped[float | None] = mapped_column(Numeric(6, 3))
    power_calculated_kw: Mapped[float | None] = mapped_column(Numeric(10, 6))
    theoretical_power_kw: Mapped[float | None] = mapped_column(Numeric(10, 6))
    mechanical_efficiency: Mapped[float | None] = mapped_column(Numeric(10, 6))
    theoretical_capacity_at_measured_rpm: Mapped[float | None] = mapped_column(Numeric(10, 4))
    slip_water: Mapped[float | None] = mapped_column(Numeric(10, 4))
    slip_viscous: Mapped[float | None] = mapped_column(Numeric(10, 4))
    theoretical_capacity_at_rated_rpm: Mapped[float | None] = mapped_column(Numeric(10, 4))
    capacity_liquid_at_rated_rpm_m3hr: Mapped[float | None] = mapped_column(Numeric(10, 4))
    capacity_liquid_at_rated_rpm_lph: Mapped[float | None] = mapped_column(Numeric(10, 2))

    report: Mapped["PumpTestReport"] = relationship(back_populates="points")
