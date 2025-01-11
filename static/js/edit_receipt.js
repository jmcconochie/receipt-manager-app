var currentJsonFile = '';


async function editReceipt(jsonUrl, jsonFileName, imageFileName, rowId) {
    // Fetch JSON data
    const response = await fetch(jsonUrl);
    const jsonData = await response.json();
    currentJsonFile = jsonFileName;

    // Populate the JSON editor with the receipt's JSON data
    document.getElementById('jsonEditor').value = JSON.stringify(jsonData, null, 2);

    // Set the image source for the image viewer
    const imageViewer = document.getElementById('imageViewer');
    imageViewer.src = imageFileName; // Set the image URL (replace with actual path)

    // Show the "Edit" tab and activate it
    const editTabButton = document.getElementById('edit-tab');
    if (editTabButton.classList.contains('d-none')) {
        editTabButton.classList.remove('d-none'); // Make the tab button visible
    }

    const tab = new bootstrap.Tab(editTabButton); // Initialize the tab
    tab.show(); // Show the tab
    document.getElementById('edit').style.display = 'block'; // Ensure it's visible
    editTabButton.style.display = 'block'; // Ensure it's visible
    currentRow = rowId;
}


document.addEventListener('DOMContentLoaded', function() {


    document.getElementById('saveChangesButton').addEventListener('click', async () => {
        const updatedJson = document.getElementById('jsonEditor').value;

        try {
            const parsedJson = JSON.parse(updatedJson); // Validate the JSON

            // Send the updated JSON to the server
            const response = await fetch('/api/update_receipt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    json_file: currentJsonFile,
                    content: parsedJson
                })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                updateDashboard(); // Update the dashboard if needed
                closeEditTab();
            } else {
                throw new Error(result.error || 'Failed to update JSON');
            }

        } catch (error) {
            console.error('Error saving JSON:', error);
            alert('Invalid JSON format. Please fix syntax errors before saving.');
        }
    });



    document.getElementById('closeEditTabButton').addEventListener('click', () => {
        closeEditTab();
    });

})