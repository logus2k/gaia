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

function showTypingIndicator() {
    document.getElementById('typing-indicator').style.display = 'flex';
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}

function hideTypingIndicator() {
    document.getElementById('typing-indicator').style.display = 'none';
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

        // Simulate voice processing
        setTimeout(() => {
            document.getElementById('audio-status').textContent = 'Ready to assist';
            addMessage('user', '[Voice message: "What is the capital of France?"]');
            showTypingIndicator();
            setTimeout(() => {
                hideTypingIndicator();
                addMessage('assistant', 'The capital of France is Paris, located in the north-central part of the country along the Seine River.');
            }, 1500);
        }, 1000);
    }
}

function replayLastResponse() {
    document.getElementById('audio-status').textContent = 'Playing audio...';
    setTimeout(() => {
        document.getElementById('audio-status').textContent = 'Ready to assist';
    }, 2000);
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

// Auto-resize textarea
document.querySelector('.chat-input').addEventListener('input', function () {
    this.style.height = 'auto';
    const minHeight = 48; // Approximately 2 lines
    this.style.height = Math.max(minHeight, Math.min(this.scrollHeight, 100)) + 'px';
});