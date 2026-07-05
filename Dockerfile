FROM python:3.14-alpine3.24
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --upgrade pip \
    && pip install --no-cache-dir --root-user-action=ignore -r requirements.txt \
    && pip uninstall --root-user-action=ignore -y pip
COPY core/      core/
COPY static/    static/
COPY templates/ templates/
COPY app.py     .
RUN adduser -u 1000 -D -H -s /sbin/nologin app && mkdir -p /app/data && chown -R app:app /app
USER app
EXPOSE 4653
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4653"]
