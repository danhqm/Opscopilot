FROM python:3.12-slim AS builder
WORKDIR /app
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM builder AS test
WORKDIR /app
ENV PYTHONPATH=/app
COPY requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY app ./app
COPY tests ./tests
CMD ["pytest", "-q"]

FROM python:3.12-slim AS runner
WORKDIR /app
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app && mkdir -p /app/uploads && chown app:app /app/uploads
COPY --from=builder /opt/venv /opt/venv
COPY app ./app
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
