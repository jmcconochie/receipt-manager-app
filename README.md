
# 📚 **Receipt Manager App**

## 🚀 **Overview**
The Receipt Manager App allows users to upload, process, and manage receipts efficiently. It uses **Flask** for the backend, **Celery** for background tasks, and **OpenAI GPT-4** for text processing and extraction.

---

## 🛠️ **Setup and Installation**

### 📦 **Dependencies**
Ensure you have the following installed:
- **Python 3.8+**
- **Redis** (for Celery task queue)
- **Docker** (optional, for containerized deployment)

### 🐍 **Install Python Dependencies**
```bash
pip install -r requirements.txt
```

### 🔑 **Environment Variables**
Create a `.env` file in your project root and add:
```env
OPENAI_API_KEY=your_openai_api_key
```

---

## ⚙️ **Running the Application**

### 📡 **Start Redis Server**
Ensure Redis is running:
```bash
redis-server
```

### 🏃 **Run Flask App**
```bash
python app.py
```

### 🎯 **Start Celery Worker**
```bash
celery -A app.celery worker --loglevel=info
```

---

## 🐳 **Docker Deployment**
1. Build the Docker image:
   ```bash
   docker build -t receipt-manager .
   ```
2. Run the container:
   ```bash
   docker run -p 5000:5000 -d receipt-manager
   ```

---

## 📊 **Key Endpoints**

- `/` → Main page
- `/upload` → Upload a receipt
- `/search` → Search receipts
- `/api/dashboard_data` → Fetch dashboard data
- `/task_status/<task_id>` → Check task status

---

## ✅ **Confirmation Steps**
1. Verify Flask is running at: `http://localhost:5000`
2. Upload a receipt and check the task status.
3. Verify Redis is processing tasks without errors.

---

## 🤝 **Contributing**
1. Fork the repository.
2. Create a feature branch:
   ```bash
   git checkout -b feature/new-feature
   ```
3. Commit changes:
   ```bash
   git commit -m "Add new feature"
   ```
4. Push changes:
   ```bash
   git push origin feature/new-feature
   ```
5. Create a Pull Request.

---

## 📝 **License**
This project is licensed under the **MIT License**.
