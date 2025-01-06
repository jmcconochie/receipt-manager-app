# Use a lightweight base (Debian-based for Tesseract)
FROM python:3.10-slim

# Install Tesseract
RUN apt-get update && apt-get install -y \
    tesseract-ocr libtesseract-dev libleptonica-dev \
    && apt-get clean

# Create a working directory
WORKDIR /app

# Copy requirements and install them
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy your Flask app
COPY . .

# Install Supervisor
RUN pip install supervisor

# Copy Supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose port 5000 for the Flask/Gunicorn app
EXPOSE 5000

# Run Gunicorn on container start
#CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000", "--timeout", "120", "--workers", "4", "-k", "gthread"]

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
