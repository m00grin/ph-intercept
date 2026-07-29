FROM python:3.14-alpine3.24
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --upgrade pip \
    && pip install --no-cache-dir --root-user-action=ignore -r requirements.txt \
    && pip uninstall --root-user-action=ignore -y pip \
    && PYLIB=/usr/local/lib/python3.14 \
    && rm -rf "$PYLIB"/ensurepip "$PYLIB"/idlelib "$PYLIB"/tkinter \
              "$PYLIB"/turtledemo "$PYLIB"/turtle.py "$PYLIB"/pydoc_data \
              "$PYLIB"/config-3.14-* "$PYLIB"/lib-dynload/_tkinter*.so \
    && rm -rf /sbin/apk /etc/apk /lib/apk /var/cache/apk /usr/share/apk
RUN adduser -u 1000 -D -H -s /sbin/nologin app && mkdir -p /app/data && chown app:app /app/data
COPY --chown=app:app core/      core/
COPY --chown=app:app static/    static/
COPY --chown=app:app templates/ templates/
COPY --chown=app:app app.py     .
USER app
EXPOSE 4653
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4653", "--timeout-graceful-shutdown", "2", "--no-server-header"]
