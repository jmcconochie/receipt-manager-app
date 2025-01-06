from app import celery
from app import process_receipt_task  

celery.conf.update(
    task_routes={
        'process_receipt_task': {'queue': 'default'}
    }
)

