// After DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const uploadButton = document.getElementById('uploadButton');
    const uploadStatusBody = document.getElementById('uploadStatusBody');
    const fileInput = document.getElementById('fileInput');
    const previewImage = document.getElementById('previewImage');

    // Check if all required elements exist
    if (!uploadForm || !fileInput || !previewImage || !uploadButton) {
        console.error('One or more required elements are missing!');
        return;
    }

    // Initialize tab triggers for the receipt manager tabs
    const triggerTabList = document.querySelectorAll('#receiptManagerTabs button');
    triggerTabList.forEach(triggerEl => {
        const tabTrigger = new bootstrap.Tab(triggerEl);
        triggerEl.addEventListener('click', event => {
            event.preventDefault();
            tabTrigger.show();
        });
    });

    // 🟢 Manual Dashboard Refresh
    document.getElementById('refreshDashboard').addEventListener('click', () => {
        updateDashboard();
    });

    // Generate filter buttons from JSON data
    const filterButtonsContainer = document.getElementById('filterButtons');
    filtersData.filters.forEach(filter => {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('btn', 'btn-outline-primary', 'filter-btn');
        button.dataset.tag = filter.tag;
        button.innerText = filter.name;

        if (filter.selected) {
            button.classList.add('btn-primary');
        }

        // Add click event listener to toggle filter selection
        button.addEventListener('click', function() {
            toggleFilter(button, filter);
        });

        filterButtonsContainer.appendChild(button);
    });

    document.addEventListener('DOMContentLoaded', () => {
        const imageViewer = document.getElementById('imageViewer');
        Panzoom(imageViewer, {
            maxScale: 3, // Maximum zoom level
            minScale: 0.5, // Minimum zoom level
            contain: 'outside', // Prevent moving outside the viewport
        });
    });

    // Initialize the dashboard after page load
    updateDashboard();
});




//*** Update Timer for Each Task




function updateTimer(id, seconds) {
    try {
        document.querySelector(`#${id} .timer`).innerText = `${seconds}s`;
    } catch {}
}


//*** Reset the Upload Form
function resetUploadForm() {
    uploadForm.reset(); // Reset the form fields
    previewImage.style.display = 'none';
    previewImage.src = '#';
}



//*** Update Status of a Receipt
function updateStatus(id, status) {
    const statusElement = document.querySelector(`#${id} .status`);
    if (statusElement) {
        statusElement.innerText = status;
    }
}


//*** Create Table Row for Each Receipt
function createStatusRow(id, fileName) {
    const row = document.createElement('tr');
    row.id = id;
    row.innerHTML = `
            <td>${receiptCount}</td>
            <td>${fileName}</td>
            <td class="status">Uploading...</td>
            <td class="timer">0s</td>
            <td>
              <button class="btn btn-sm btn-danger" onclick="cancelTask('${id}')">Cancel</button>
            </td>
          `;
    return row;
}



// 🔄 Poll Task Status
function startPolling(receiptId, taskId) {
    let seconds = 0;

    taskIntervals[receiptId] = setInterval(async () => {
        updateTimer(receiptId, seconds++);
        try {
            const response = await fetch(`/api/task_status/${taskId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch task status');
            }
            const data = await response.json();

            switch (data.status) {
                case 'SUCCESS':
                    updateStatus(receiptId, 'Completed');
                    clearInterval(taskIntervals[receiptId]);
                    break;
                case 'FAILURE':
                    updateStatus(receiptId, 'Failed');
                    clearInterval(taskIntervals[receiptId]);
                    break;
                default:
                    updateStatus(receiptId, data.status || 'Processing');
                    break;
            }
        } catch (error) {
            console.error('Error polling status:', error);
            updateStatus(receiptId, 'Error');
            clearInterval(taskIntervals[receiptId]);
        }
    }, 1000); // Poll every second
}




document.addEventListener('DOMContentLoaded', function() {




    // 🟢 Handle Multiple File Uploads
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        uploadButton.disabled = true; // Prevent multiple submissions

        const files = fileInput.files;

        if (!files.length) {
            alert('Please select a receipt image!');
            uploadButton.disabled = false;
            return;
        }

        Array.from(files).forEach(async (file) => {
            const receiptId = `receipt-${receiptCount++}`;
            const row = createStatusRow(receiptId, file.name);
            uploadStatusBody.appendChild(row);

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error('Failed to upload file');
                }

                const result = await response.json();
                if (result.task_id) {
                    updateStatus(receiptId, 'Queued');
                    startPolling(receiptId, result.task_id);
                }

                // Show confirmation on button and reset form
                uploadButton.innerText = 'Receipt Sent for Processing';
                setTimeout(() => {
                    resetUploadForm();
                    uploadButton.innerText = 'Upload Receipt';
                    uploadButton.disabled = false;
                }, 1000);
            } catch (error) {
                console.error('Error during upload:', error);
                updateStatus(receiptId, 'Failed');
                uploadButton.disabled = false;
            }
        });
    });




    // 🖼️ Image Preview on File Select
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                previewImage.src = event.target.result;
                previewImage.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });
})