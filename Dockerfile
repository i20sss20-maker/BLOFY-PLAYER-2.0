FROM python:3.12-alpine
WORKDIR /app
COPY tools/aab-share/server.py /app/server.py
EXPOSE 8080
CMD ["python", "/app/server.py"]
