var receiptCount = 0;
var taskIntervals = {};
var currentRow = null; // Store the row being edited

var buttonStates = {}; // Object to track button states (in-progress)
var seconds = {}

var taskIntervals_rescan = {}; // Initialize globally


// Initial JSON data for filters
var filtersData = {
    "filters": [
      { "name": "J", "tag": "month-0", "selected": false },
      { "name": "F", "tag": "month-1", "selected": false },
      { "name": "M", "tag": "month-2", "selected": false },
      { "name": "A", "tag": "month-3", "selected": false },
      { "name": "M", "tag": "month-4", "selected": false },
      { "name": "J", "tag": "month-5", "selected": false },
      { "name": "J", "tag": "month-6", "selected": false },
      { "name": "A", "tag": "month-7", "selected": false },
      { "name": "S", "tag": "month-8", "selected": false },
      { "name": "O", "tag": "month-9", "selected": false },
      { "name": "N", "tag": "month-10", "selected": false },
      { "name": "D", "tag": "month-11", "selected": false },
      { "name": "Tax", "tag": "category-tax", "selected": false },
      { "name": "RfL", "tag": "category-read_for_life", "selected": false },
      { "name": "Warranty", "tag": "category-warranty", "selected": false },
      { "name": "FY", "tag": "financial-year", "selected": false },
      { "name": "Scanned Today", "tag": "scanned-today", "selected": false }
    ]
  };



// Get the current year and the last 2 years
const currentYear = new Date().getFullYear();
const lastThreeYears = [currentYear - 2, currentYear - 1, currentYear]; // Last 3 years

document.addEventListener('DOMContentLoaded', function() {
    // Dynamically add year filters to filtersData
    lastThreeYears.forEach(year => {
        filtersData.filters.push({
            "name": year.toString(), // Convert the year to string
            "tag": `year-${year}`, // Generate a tag like "year-2023"
            "selected": false // Initially not selected
        });
    });
});



function scrollToRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {


        // Scroll the row into view
        row.scrollIntoView({
            behavior: 'smooth', // Smooth scrolling
            block: 'center', // Center the row in the viewport
        });

        // Remove the green dot after a short delay (e.g., 2 seconds)
        setTimeout(() => {
            greenDot.remove();
        }, 2000); // Adjust the duration as needed
    }
}


//*** deleteReceipt
async function deleteReceipt(jsonFile, imageFile, rowId) {
    if (!confirm('Are you sure you want to delete this receipt?')) return;

    try {
        const response = await fetch('/api/delete_receipt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                json_file: jsonFile,
                image_file: imageFile
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert('Receipt deleted successfully!');
            document.getElementById(rowId).remove(); // Remove the row from the table
            updateDashboard();
        } else {
            throw new Error(result.error || 'Failed to delete receipt');
        }
    } catch (error) {
        console.error('Error deleting receipt:', error);
        alert('Failed to delete receipt. Please try again.');
    }
}



//*** updateDashboard
function updateDashboard() {
    fetch('/api/dashboard_data')
        .then(response => response.json())
        .then(data => {
            const tableBody = document.getElementById('dashboard_body');
            let newHtml = '';
            data.forEach((receipt, index) => {
                isMatch = filter_receipt(receipt);
                if (isMatch) {
                    let rescan_btn_id = `rescan-btn-${receipt.image_path.split('/').pop()}`;
                    newHtml += `
                              <tr id="receipt-${receipt.json_path.split('/').pop().split('.')[0]}" data-scanned-on="${receipt.scanned_on || ''}" class="receipt-row" tabindex="0">
                                  <td class="complete-status">
                                    ${receipt.complete === "complete" ? "" : '<i class="fas fa-exclamation-circle text-warning" title="Incomplete Receipt"></i>'}
                                  </td>
                                  <td>
                                    <span class="receipt-date">${receipt.date || 'N/A'}</span>
                                    <br>
                                    <span class="receipt-store">${receipt.store || 'N/A'}</span>
                                  </td>
                                  <td>${receipt.total || '0.0'}</td>
                                  <td>${receipt.items || 'No Items Listed'}</td>
                                  <td>${receipt.categories || 'None'}</td>
                                  <td>
                                    <div class="action-buttons">
                                    <button class="action-button material-btn-round" onclick="editReceipt('${receipt.json_path}', '${receipt.json_path.split('/').pop()}', '${receipt.image_path}', 'receipt-${receipt.json_path.split('/').pop().split('.')[0]}')"> 
                                      <i class="fas fa-edit"></i> 
                                    </button>
                                    <button class="action-button material-btn-round" id="${rescan_btn_id}" onclick="rescanReceipt('${receipt.image_path.split('/').pop()}')">
                                      <i class="fas fa-sync-alt"></i> 
                                    </button>
                                    <button class="action-button material-btn-round" onclick="deleteReceipt('${receipt.json_path}', '${receipt.image_path}', 'receipt-${receipt.json_path.split('/').pop().split('.')[0]}')">
                                      <i class="fas fa-trash"></i> 
                                    </button>
                                    </div>
                                  </td>
                              </tr>
                          `;
                }
            });
            tableBody.innerHTML = newHtml;




            // Restart timers for in-progress buttons
            Object.keys(buttonStates).forEach(buttonId => {
                if (buttonStates[buttonId] === 'in-progress') {
                    const button = document.getElementById(buttonId);
                    if (button) {
                        button.style.backgroundColor = 'red';
                        if (!taskIntervals_rescan[buttonId]) {
                            startPolling_rescan(null, button); // Resume timer
                        }
                    }
                }
            });




            // const rows = document.querySelectorAll('.receipt-row'); // Select all rows
            // rows.forEach(row => {
            //     const button = row.querySelector('.action-button[id^="rescan-btn-"]'); // Find rescan button
            //     if (buttonStates[button.id]=='in-progress') {
            //       button.innerText = `${seconds[button.id]}s`; 
            //       button.style.backgroundColor = 'red'; // Reset button style
            //     }
            // });
            setActiveRow(currentRow);
        })
        .catch(error => console.error('Error fetching dashboard data:', error));
}



// Function to manually parse Australian date format (dd/mm/yyyy)
function parseAustralianDate(dateString) {
    const [day, month, year] = dateString.split('/'); // Split the date string
    return new Date(`${year}-${month}-${day}`); // Create a Date object in YYYY-MM-DD format
}

function filter_receipt(receipt) {
    // Collect the selected tags from the filters
    const selectedTags = filtersData.filters.filter(filter => filter.selected).map(filter => filter.tag);

    // Month filter: Check if receipt date's month matches the selected months
    const receiptDate = parseAustralianDate(receipt.date); // Parse the receipt date in Australian format
    const receiptMonth = receiptDate.getMonth(); // Extracts month from the date (0 = January)

    // Get the list of selected month tags (e.g., "month-0", "month-1", etc.)
    const monthTags = selectedTags.filter(tag => tag.startsWith('month-')).map(tag => parseInt(tag.split('-')[1], 10));

    // Year filter: Check if the receipt's year matches the selected years
    const receiptYear = receiptDate.getFullYear(); // Extract the year from the receipt date
    const yearTags = selectedTags.filter(tag => tag.startsWith('year-')).map(tag => parseInt(tag.split('-')[1], 10));
    // If no months are selected, we should consider all months for the selected years
    const matchesMonth = monthTags.length === 0 || monthTags.includes(receiptMonth);
    // If no years are selected, we should consider all years for the selected months
    const matchesYear = yearTags.length === 0 || yearTags.includes(receiptYear);

    // Category filter: If no categories are selected, it should not limit the search (i.e., consider all categories)
    const categoryTags = selectedTags.filter(tag => tag.startsWith('category-')).map(tag => tag.split('-')[1]);
    // If no categories are selected, allow all categories to pass (matchesCategory will always be true)
    const matchesCategory = categoryTags.length === 0 || categoryTags.some(selectedCategory => receipt.categories.includes(selectedCategory));
    // Log category matching for debugging

    // **Scanned Today Filter**: Check if the "scanned-today" filter is selected
    // Get the current local time
    const localDate = new Date();
    const utcYear = localDate.getUTCFullYear();
    const utcMonth = localDate.getUTCMonth(); // Months are zero-indexed (0 = January)
    const utcDate = localDate.getUTCDate();
    const utcDateObject = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0));
    utcDateObject.setHours(0, 0, 0, 0); // Set the time part to 00:00:00 to only compare the date

    const dateString = receipt.scanned_on;
    const scannedOnDate = new Date(dateString);
    scannedOnDate.setHours(0, 0, 0, 0); // Set the time part to 00:00:00 to only compare the date
    const matchesToday = selectedTags.includes('scanned-today') ? (scannedOnDate.getTime() === utcDateObject.getTime()) : true;

    // Financial Year filter: Check if the receipt's date is within the last financial year (Jul - Jun)
    const currentDate = new Date();
    const lastFinancialYearStart = new Date(currentDate.getFullYear() - 1, 6, 1); // July 1 of last year
    const lastFinancialYearEnd = new Date(currentDate.getFullYear(), 5, 30); // June 30 of this year
    const matchesFinancialYear = !selectedTags.includes('financial-year') || (receiptDate >= lastFinancialYearStart && receiptDate <= lastFinancialYearEnd);

    // Return true if the receipt matches all selected filters (Month, Year, Category, Financial Year, and Scanned Today)
    return matchesYear && matchesMonth && matchesCategory && matchesFinancialYear && matchesToday;
}



// Function to reset button state
function resetButton(button) {
    if (button) {
        button.style.backgroundColor = ''; // Reset button style
        delete buttonStates[button.id];
    }
}



function updateRow(rowId, newStatus) {
    const row = document.getElementById(rowId);
    if (row) {
        row.querySelector('.status-cell').innerText = newStatus;
    }
}




function rescanReceipt(jsonFileName) {
    if (!confirm('Are you sure you want to rescan this receipt?')) return;

    const button = document.getElementById(`rescan-btn-${jsonFileName}`);
    if (button) {
        button.style.backgroundColor = 'red'; // Change button color to red
        buttonStates[button.id] = 'in-progress'; // Track state
        seconds[button.id] = 0; // Track time in state
    }

    const formData = new FormData();
    formData.append('rescan_filename', jsonFileName);

    fetch('/api/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            if (result.task_id) {
                startPolling_rescan(result.task_id, button); // Pass button to reset color
            } else {
                alert('Failed to start rescan task.');
                if (button) {
                    button.style.backgroundColor = ''; // Reset button color
                }
            }
        })
    // .catch(error => {
    //   console.error('Error during rescan:', error);
    //   alert('Failed to initiate rescan. Please try again.');
    //   if (button) {
    //     button.style.backgroundColor = ''; // Reset button color
    //   }
    // });
}


function startPolling_rescan(taskId, button) {
    const buttonId = button.id;

    // Start or resume timer
    if (!taskIntervals_rescan[buttonId]) {
        taskIntervals_rescan[buttonId] = setInterval(() => {
            seconds[buttonId]++;
            const currentButton = document.getElementById(buttonId); // Get button after reload
            if (currentButton) {
                currentButton.innerText = `${seconds[buttonId]}s`; // Update button text
            }
        }, 1000);
    }

    // Poll the task status
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/task_status/${taskId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const data = await response.json();

            switch (data.status) {
                case 'SUCCESS':
                case 'FAILURE':
                    clearInterval(taskIntervals_rescan[buttonId]);
                    clearInterval(pollInterval); // Stop polling
                    delete taskIntervals_rescan[buttonId];
                    delete buttonStates[buttonId];
                    updateDashboard();
                    break;
                default:
                    // Continue polling
                    break;
            }
        } catch (error) {
            console.error('Error polling status:', error);
            clearInterval(taskIntervals_rescan[buttonId]);
            clearInterval(pollInterval); // Stop polling on error
            delete taskIntervals_rescan[buttonId];
            delete buttonStates[buttonId];
        }
    }, 1000);
}




function closeEditTab() {
    // Hide the Edit tab content
    const editTabContent = document.getElementById('edit');
    editTabContent.classList.remove('show', 'active');

    // Hide the "Edit" tab in the navigation
    const editTab = document.getElementById('edit-tab');
    editTab.classList.add('d-none'); // Hide the tab in the navigation

    // Show the previous tab (for example, "Dashboard" tab)
    const dashboardTab = new bootstrap.Tab(document.getElementById('dashboard-tab'));
    dashboardTab.show(); // Switch back to the Dashboard tab

    // Reset the JSON editor and image viewer
    document.getElementById('jsonEditor').value = ''; // Clear the JSON editor
    document.getElementById('imageViewer').src = ''; // Clear the image viewer

    // Scroll to the row 
    const row = document.getElementById(currentRow);
    if (row) {
        row.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }
    setActiveRow(currentRow);
}


// Function to add the active row class to a specific row
function setActiveRow(rowId) {
    // Remove the active class from all rows
    const allRows = document.querySelectorAll('.receipt-row');
    allRows.forEach(row => {
        row.classList.remove('table-active'); // Remove active class from all rows
    });
    // Add the active class to the specific row
    const row = document.getElementById(rowId);
    if (row) {
        row.classList.add('table-active'); // Add active class to the row
        row.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }
    currentRow = rowId;
}


// Toggle filter selection state
function toggleFilter(button, filter) {
    filter.selected = !filter.selected;

    // Update button appearance based on selection
    if (filter.selected) {
        button.classList.remove('btn-outline-primary');
        button.classList.add('btn-primary');
    } else {
        button.classList.remove('btn-primary');
        button.classList.add('btn-outline-primary');
    }
    // Call function to update the dashboard based on filters
    updateDashboard();
}