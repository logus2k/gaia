function openAudioSettings() {
    document.getElementById('audio-modal').style.display = 'flex';
}

function openHelp() {
    document.getElementById('help-modal').style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Close modal when clicking outside
document.addEventListener('click', function (event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.style.display = 'none';
    }
});

// Close modal with ESC key
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        const modals = document.querySelectorAll('.modal-overlay');
        modals.forEach(modal => modal.style.display = 'none');
    }
});

function addMessage(type, content) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    messageDiv.innerHTML = `
                <div class="message-bubble">${content}</div>
                <div class="message-time">${timeString}</div>
            `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageDiv.querySelector('.message-bubble');
}

let isRecording = false;
function startRecording() {
    if (!isRecording) {
        isRecording = true;
        const btn = event.target.closest('.control-btn');
        btn.classList.add('recording');
        document.getElementById('audio-status').textContent = 'Recording...';
    }
}

function stopRecording() {
    if (isRecording) {
        isRecording = false;
        const btn = event.target.closest('.control-btn');
        btn.classList.remove('recording');
        document.getElementById('audio-status').textContent = 'Processing voice...';
    }
}

function replayLastResponse() {
    document.getElementById('audio-status').textContent = 'Playing audio...';
}

function toggleTTS() {
    const btn = event.target.closest('.control-btn');
    btn.classList.toggle('active');
    const isActive = btn.classList.contains('active');
    btn.setAttribute('data-tooltip', isActive ? 'Text-to-Speech enabled' : 'Text-to-Speech disabled');
}

function toggleVoiceActivation() {
    const btn = event.target.closest('.control-btn');
    btn.classList.toggle('active');
    const isActive = btn.classList.contains('active');
    btn.setAttribute('data-tooltip', isActive ? 'Voice activation enabled' : 'Voice activation disabled');
}

addMessage("assistant", "Hello! I'm Gaia, your Earth Exploration Assistant.");
