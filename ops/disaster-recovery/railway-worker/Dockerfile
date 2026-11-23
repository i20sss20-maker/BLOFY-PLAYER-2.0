FROM postgres:18-bookworm
RUN apt-get update -qq && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python3 -m venv /opt/blofy-venv && /opt/blofy-venv/bin/pip install --no-cache-dir -r requirements.txt
COPY worker.py restore_audit.py recover_offline.py test_restore_local.py verify_latest.py /app/
ENV PATH="/opt/blofy-venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
USER postgres
CMD ["python3", "/app/worker.py"]
