FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn[standard] httpx jinja2 python-multipart

COPY core/      core/
COPY static/    static/
COPY templates/ templates/
COPY app.py     .

EXPOSE 4653
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4653"]
