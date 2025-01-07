import os
import io
import json
import uuid
import csv
import shutil
import zipfile
from datetime import datetime
from dotenv import load_dotenv

import requests
from flask import Flask, request, jsonify, render_template, Response, send_file
from celery import Celery
from celery.result import AsyncResult
from openai import OpenAI
import openai
import pytesseract
from PIL import Image, ImageOps

load_dotenv()
api_key = os.environ.get("OPENAI_API_KEY")
client = OpenAI(api_key=api_key)
CHATGPT_MODEL = "gpt-4o-mini"

app = Flask(__name__)
app.config.update(
    broker_url='redis://172.17.0.1:6379/0',
    result_backend='redis://172.17.0.1:6379/0'
)
celery = Celery(
    app.import_name,
    broker=app.config['broker_url'],
    backend=app.config['result_backend']
)
celery.conf.update(app.config)


UPLOAD_FOLDER = os.path.join('static', 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


# --------------------------------------------------------------------
# / and DATA GATHERING
# --------------------------------------------------------------------

@app.route("/", methods=["GET"])
def index():
    """Main Web Page Root

    Returns:
        template: main web page
    """
    return render_template('index.html')


def get_all_receipts():
    """
    Fetch all receipts from JSON files in the UPLOAD_FOLDER.
    Extracts key fields: date, store, total, category.
    Includes image and JSON file paths.
    Returns receipts sorted in reverse date order.
    """
    upload_dir = app.config['UPLOAD_FOLDER']
    receipts = []

    for filename in os.listdir(upload_dir):
        if filename.lower().endswith('.json'):
            json_path = os.path.join(upload_dir, filename)
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                base_name = os.path.splitext(filename)[0]
                receipt = {
                    'date': data.get('tax_invoice', {}).get('date', 'N/A'),
                    'store': data.get('store', {}).get('name', 'N/A'),
                    'total': float(data.get('totals', {}).get('grand_total', 0.0)),
                    'items': ', '.join([item.get('description', 'N/A') for item in data.get('items', [])]),
                    'category': data.get('notes', 'N/A'),
                    'image_path': None,
                    'json_path': f'/static/uploads/{filename}'
                }
                print(receipt)
                receipt['categories'] = data.get('categories', [])

                # Ensure the date is valid
                if not receipt['date'] or receipt['date'].lower() == 'unknown':
                    receipt['date'] = 'N/A'

                # Check for associated image
                possible_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp']
                for ext in possible_extensions:
                    image_file = f"{base_name}{ext}"
                    image_path = os.path.join(upload_dir, image_file)
                    if os.path.isfile(image_path):
                        receipt['image_path'] = f'/static/uploads/{image_file}'
                        break

                receipts.append(receipt)

            except (json.JSONDecodeError, KeyError) as e:
                print(f"Error reading {json_path}: {e}")

    # .. sort receipts by date in reverse order
    try:
        receipts.sort(key=lambda x: x['date'], reverse=True)
    except KeyError:
        print("Sorting failed due to missing date fields in some receipts.")

    return receipts


#@app.route('/api/dashboard_data')
#def dashboard_data():
#    receipts = get_all_receipts()
#    sorted_receipts = sorted(receipts, key=lambda x: x['date'], reverse=True)
#    return jsonify(sorted_receipts)

@app.route('/api/dashboard_data')
def dashboard_data():
    receipts = get_all_receipts()
    
    def parse_date_or_default(date_str):
        """
        Parse a date string using multiple formats or fallback to a default.
        """
        date_formats = ["%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y"]
        for fmt in date_formats:
            try:
                return datetime.strptime(date_str, fmt)
            except (ValueError, TypeError):
                continue
        # If all formats fail, fallback to current datetime
        return datetime.min
    
    # Parse and sort receipts by date, handle 'N/A' or invalid formats
    sorted_receipts = sorted(
        receipts,
        key=lambda x: parse_date_or_default(x.get('date', 'N/A')),
        reverse=True
    )
    
    # Add notes for invalid dates
    for receipt in receipts:
        if receipt.get('date') in (None, 'N/A', ''):
            receipt['notes'] = receipt.get('notes', '') + " Date was invalid or missing, default sorting applied."
    
    return jsonify(sorted_receipts)


# --------------------------------------------------------------------
# UPLOAD
# --------------------------------------------------------------------

@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    unique_id = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename)[1]
    safe_filename = f"{unique_id}{file_ext}"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_filename)
    file.save(file_path)

    # .. queue the receipt processing task
    task = process_receipt_task.delay(safe_filename, request.form.get('categories'))

    return jsonify({
        "success": True,
        "message": "Receipt uploaded successfully and will be processed in the background.",
        "image_path": f"/static/uploads/{safe_filename}",
        "task_id": task.id
    })


@celery.task(bind=True)
def process_receipt_task(self, filename, categories):
    """
    Celery task to process a receipt image, perform OCR, and save the parsed JSON.
    """
    try:
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        # Validate if file exists
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"File {filename} does not exist.")

        # Process image
        with Image.open(file_path) as img:
            img = ImageOps.exif_transpose(img)

            config = '--psm 1'
            ocr_text1 = pytesseract.image_to_string(img, lang='eng', config=config)

            gray = img.convert("L")
            #bw = gray.point(lambda x: 0 if x < 128 else 255, '1')
            gray.info['dpi'] = (300, 300)
            config = '--psm 1'
            ocr_text2 = pytesseract.image_to_string(gray, lang='eng', config=config)

        # Parse receipt using OpenAI API
        parsed_json = chatgpt_parse_receipt(ocr_text1, ocr_text2)
        parsed_json['categories'] = json.loads(categories) if categories else []
        parsed_json['scanned_on'] = datetime.now().isoformat()

        # Ensure 'notes' exists and is a string
        if 'notes' not in parsed_json or not isinstance(parsed_json['notes'], str):
            parsed_json['notes'] = ''

        # Save JSON output
        json_filename = f"{os.path.splitext(filename)[0]}.json"
        json_path = os.path.join(app.config['UPLOAD_FOLDER'], json_filename)
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(parsed_json, f, ensure_ascii=False, indent=2)

        # Task result
        return {
            "status": "success",
            "message": "Receipt processed successfully.",
            "json_path": json_filename
        }

    except Exception as e:
        self.update_state(state='FAILURE', meta={'error': str(e)})
        raise e


def chatgpt_parse_receipt(ocr_text1, ocr_text2):
    """
    Sends the OCR'd text to ChatGPT with instructions to return well-formed JSON.
    Uses the new openai.ChatCompletion object interface in openai>=1.0.0.
    """
    print("===========1")
    print(ocr_text1)
    print("===========2")
    print(ocr_text2)

    prompt = f"""
You are a helpful assistant that reads receipt text and extracts key fields in valid JSON.
The receipt image has been OCR'd twice with different settings.  The receipt text from both scans is given,
with the first scan text enclosed in triple parenthesis and the second scan text enclosed in triple square brackets:
((({ocr_text1})))
[[[{ocr_text2}]]]

Instructions:
1. Identify store name, ABN, address, phone, date, items, total, etc.
2. Return ONLY valid JSON with the following structure (if something not found, leave blank or null):
3. Make any obvious spelling corrections coming from the OCR of the receipt
4. Make sure totals make sense.
5. Check the date makes sense, usually it will be in Australian format, and if not make a best guess and put in the notes about that.
6. Check for known vendors and correct and vendor name mispelling.
7. Return all dates as dd/mm/yyyy
{{
  "store": {{
    "name": "",
    "abn": "",
    "phone": "",
    "address": ""
  }},
  "tax_invoice": {{
    "invoice_number": "",
    "date": ""
  }},
  "transaction": {{
    "transaction_number": "",
    "date_time": "",
    "team_member": "",
    "payment_method": "",
    "approval_code": "",
    "amount": 0.0,
    "gst_included": 0.0
  }},
  "items": [
    {{
      "description": "",
      "price": 0.0,
      "gst_in_item": 0.0
    }}
  ],
  "totals": {{
    "subtotal": 0.0,
    "gst_included": 0.0,
    "grand_total": 0.0
  }},
  "notes": ""
}}
"""
    raw_reply = ""
    try:
        completion = client.chat.completions.create(model=CHATGPT_MODEL,
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant for parsing receipts."
            },
            {
                "role": "user",
                "content": prompt
            },
        ],
        temperature=0)

        # .. access the content property directly from the object
        raw_reply = completion.choices[0].message.content.strip()

        # .. remove code block formatting (```json ... ```), if it exists
        if raw_reply.startswith("```json"):
            raw_reply = raw_reply[7:].strip()  # Remove the starting "```json"
        if raw_reply.endswith("```"):
            raw_reply = raw_reply[:-3].strip()  # Remove the ending "```"

        # .. attempt to parse JSON
        data = json.loads(raw_reply)
        print(data)
        return data

    except Exception as e:
        # If the model returns invalid JSON or some other error occurs, handle gracefully
        return {"error": str(e), "raw_reply": raw_reply}


@app.route('/task_status/<task_id>', methods=['GET'])
def task_status(task_id):
    """Gets status of receipt processing tasks

    Args:
        task_id (_type_): task_id returned by process_receipt_task

    Returns:
        json: task data
    """
    result = AsyncResult(task_id)
    response = {
        'task_id': task_id,
        'status': result.status,
        'result': result.result
    }
    return jsonify(response)







# --------------------------------------------------------------------
# SEARCH
# --------------------------------------------------------------------

@app.route("/search", methods=["GET"])
def search():
    """runs search with q=search_string and category=???

    Returns:
        html: search results as html
    """
    query = request.args.get("q", "").lower().strip()
    selected_categories = request.args.getlist("category")

    results = []
    upload_dir = app.config["UPLOAD_FOLDER"]

    for filename in os.listdir(upload_dir):
        if filename.lower().endswith(".json"):
            json_path = os.path.join(upload_dir, filename)
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Check query match
            text_blob = json.dumps(data).lower()
            matches_query = query in text_blob if query else True

            # Check category match
            matches_category = any(cat in data.get('categories', []) for cat in selected_categories) if selected_categories else True

            if matches_query and matches_category:
                base_name = os.path.splitext(filename)[0]
                image_path = None
                for ext in ['.jpg', '.jpeg', '.png']:
                    candidate = f"{base_name}{ext}"
                    if os.path.isfile(os.path.join(upload_dir, candidate)):
                        image_path = f"{candidate}"
                        break

                results.append({
                    "json_file": filename,
                    "json_data": data,
                    "image_file": image_path
                })

    return render_template("search_results.html", query=query, results=results)




# --------------------------------------------------------------------
# DASHBOARD
# --------------------------------------------------------------------

@app.route('/export/zip')
def export_zip():
    """
    Export the entire dataset as a ZIP file with a local HTML index.
    """
    try:
        upload_dir = app.config['UPLOAD_FOLDER']
        export_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'export')
        os.makedirs(export_dir, exist_ok=True)

        zip_file_path = os.path.join(export_dir, 'receipt_dataset.zip')
        html_index_path = os.path.join(export_dir, 'index.html')

        # 1. Create Local HTML Index
        with open(html_index_path, 'w', encoding='utf-8') as index_file:
            index_file.write("""
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Local Receipt Dataset</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f4f4f4; }
                    img { max-width: 100px; max-height: 100px; }
                    a { text-decoration: none; color: blue; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>Receipt Dataset</h1>
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Store</th>
                            <th>Total</th>
                            <th>Items</th>
                            <th>Image</th>
                            <th>JSON</th>
                        </tr>
                    </thead>
                    <tbody>
            """)

            for filename in os.listdir(upload_dir):
                if filename.endswith('.json'):
                    json_path = os.path.join(upload_dir, filename)
                    with open(json_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    date = data.get('tax_invoice', {}).get('date', 'N/A')
                    store = data.get('store', {}).get('name', 'N/A')
                    total = data.get('totals', {}).get('grand_total', '0.0')
                    items = ', '.join([item.get('description', 'N/A') for item in data.get('items', [])])

                    base_name = os.path.splitext(filename)[0]
                    image_file = None
                    for ext in ['.jpg', '.jpeg', '.png', '.webp', '.bmp']:
                        candidate = f"{base_name}{ext}"
                        if os.path.isfile(os.path.join(upload_dir, candidate)):
                            image_file = candidate
                            break

                    image_path = image_file if image_file else 'N/A'

                    index_file.write(f"""
                        <tr>
                            <td>{date}</td>
                            <td>{store}</td>
                            <td>{items}</td>
                            <td>{total}</td>
                            <td>{f'<img src="{image_path}" alt="Receipt Image">' if image_file else 'No Image'}</td>
                            <td><a href="{filename}">View JSON</a></td>
                        </tr>
                    """)

            index_file.write("""
                    </tbody>
                </table>
            </body>
            </html>
            """)

        # 2. Create ZIP File
        with zipfile.ZipFile(zip_file_path, 'w') as zipf:
            # Add all JSON and image files
            for filename in os.listdir(upload_dir):
                file_path = os.path.join(upload_dir, filename)
                if filename.endswith(('.json', '.jpg', '.jpeg', '.png', '.webp', '.bmp')):
                    zipf.write(file_path, arcname=filename)

            # Add the generated HTML index
            zipf.write(html_index_path, arcname='index.html')

        # 3. Send the ZIP file
        return send_file(zip_file_path, as_attachment=True)

    except Exception as e:
        print(f"Error exporting dataset: {e}")
        return jsonify({"error": str(e)}), 500

    finally:
        # Cleanup the export directory
        shutil.rmtree(export_dir, ignore_errors=True)



@app.route('/export/csv')
def export_csv():
    """
    Export all receipts as a CSV file with relevant fields.
    """
    upload_dir = app.config['UPLOAD_FOLDER']
    csv_output = io.StringIO()
    csv_writer = csv.writer(csv_output)

    # Define the CSV headers based on JSON structure
    headers = [
        "store_name", "store_abn", "store_phone", "store_address",
        "invoice_number", "invoice_date",
        "transaction_number", "transaction_date_time", "payment_method", "amount", "gst_included",
        "subtotal", "grand_total",
        "items",
        "notes"
    ]
    headers.append('categories')

    csv_writer.writerow(headers)

    for filename in os.listdir(upload_dir):
        if filename.lower().endswith('.json'):
            json_path = os.path.join(upload_dir, filename)
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Extract data with safe defaults
                store = data.get('store', {})
                tax_invoice = data.get('tax_invoice', {})
                transaction = data.get('transaction', {})
                totals = data.get('totals', {})
                items = data.get('items', [])
                notes = data.get('notes', '')

                # Flatten the data for CSV
                row = [
                    store.get('name', 'N/A'),
                    store.get('abn', 'N/A'),
                    store.get('phone', 'N/A'),
                    store.get('address', 'N/A'),
                    tax_invoice.get('invoice_number', 'N/A'),
                    tax_invoice.get('date', 'N/A'),
                    transaction.get('transaction_number', 'N/A'),
                    transaction.get('date_time', 'N/A'),
                    transaction.get('payment_method', 'N/A'),
                    transaction.get('amount', 0.0),
                    transaction.get('gst_included', 0.0),
                    totals.get('subtotal', 0.0),
                    totals.get('grand_total', 0.0),
                    ', '.join([item.get('description', 'N/A') for item in data.get('items', [])]), 
                    notes
                ]
                row.append(', '.join(data.get('categories', [])))

                csv_writer.writerow(row)

            except (json.JSONDecodeError, KeyError) as e:
                print(f"Error processing {json_path}: {e}")

    # Return CSV as downloadable file
    response = Response(csv_output.getvalue(), mimetype='text/csv')
    response.headers['Content-Disposition'] = 'attachment; filename=receipts_export.csv'
    return response



@app.route("/delete_receipt", methods=["POST"])
def delete_receipt():
    """
    Delete both the JSON and image files associated with a receipt.
    """
    try:
        data = request.get_json()
        json_path = data.get('json_file')
        image_path = data.get('image_file')

        if not json_path:
            return jsonify({"error": "Missing JSON path"}), 400

        # Remove JSON file
        full_json_path = os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(json_path))
        if os.path.isfile(full_json_path):
            os.remove(full_json_path)

        # Remove Image file if provided
        if image_path:
            full_image_path = os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(image_path))
            if os.path.isfile(full_image_path):
                os.remove(full_image_path)

        return jsonify({"success": True, "message": "Receipt deleted successfully"})

    except Exception as e:
        print(f"Error deleting receipt: {e}")
        return jsonify({"error": str(e)}), 500




@app.route('/update_receipt', methods=['POST'])
def update_receipt():
    """
    Update the JSON data of a receipt file.
    Receives JSON data via POST and updates the file.
    """
    try:
        data = request.get_json()
        json_file = data.get('json_file')
        updated_content = data.get('content')

        if not json_file or not updated_content:
            return jsonify({"error": "Missing json_file or content"}), 400

        json_path = os.path.join(app.config['UPLOAD_FOLDER'], json_file)
        if not os.path.isfile(json_path):
            return jsonify({"error": "JSON file not found"}), 404

        # Save the updated content
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(updated_content, f, ensure_ascii=False, indent=2)

        return jsonify({"success": True, "message": "Receipt updated successfully"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500



if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
