FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY core/      core/
COPY static/    static/
COPY templates/ templates/
COPY app.py     .

RUN useradd -u 1000 -M app && chown -R app:app /app
USER app

EXPOSE 4653
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4653"]
