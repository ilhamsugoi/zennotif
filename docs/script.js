// ===== ZenNotif Landing Page Interactions =====

// Demo notification simulation
let ticketCounter = 4521;

function simulateTicket() {
  const ticketList = document.getElementById('ticket-list');
  const notificationToast = document.getElementById('notification-toast');
  const extensionBadge = document.getElementById('extension-badge');
  const demoStatus = document.getElementById('demo-status');
  
  ticketCounter++;
  
  // Add new ticket to the list
  const newTicket = document.createElement('div');
  newTicket.className = 'ticket-item new-ticket';
  newTicket.innerHTML = `
    <span class="ticket-id">#${ticketCounter}</span>
    <span class="ticket-subject">New customer inquiry</span>
    <span class="ticket-status new">New</span>
  `;
  
  ticketList.insertBefore(newTicket, ticketList.firstChild);
  
  // Show extension badge
  extensionBadge.classList.add('show');
  
  // Show notification toast in popup preview
  notificationToast.classList.add('show');
  
  // Update status
  demoStatus.textContent = `✅ New ticket #${ticketCounter} detected! Notification sent.`;
  demoStatus.style.color = '#4CAF50';
  
  // Play tone
  playTone('bell');
  
  // Hide toast after 3 seconds
  setTimeout(() => {
    notificationToast.classList.remove('show');
  }, 3000);
  
  // Remove highlight from ticket after animation
  setTimeout(() => {
    newTicket.classList.remove('new-ticket');
  }, 5000);
}

// Audio tone simulation (visual feedback only - browsers block autoplay)
function playTone(tone) {
  const demoStatus = document.getElementById('demo-status');
  const tones = {
    'bell': '🔔 Bell tone playing...',
    'chime': '🎵 Chime tone playing...',
    'alert': '🚨 Alert tone playing...',
    'soft': '🎶 Soft tone playing...'
  };
  
  demoStatus.textContent = tones[tone] || tones['bell'];
  demoStatus.style.color = '#2196F3';
  
  // In a real scenario, this would play audio
  // For demo, we just show visual feedback
  console.log(`Playing ${tone} tone...`);
}

// Code tab switching
function showCode(tabId) {
  // Hide all panels
  document.querySelectorAll('.code-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  // Remove active class from all tabs
  document.querySelectorAll('.code-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected panel
  document.getElementById(`code-${tabId}`).classList.add('active');
  
  // Add active class to clicked tab
  event.target.classList.add('active');
}

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Navbar scroll effect
window.addEventListener('scroll', () => {
  const navbar = document.querySelector('.navbar');
  if (window.scrollY > 100) {
    navbar.style.background = 'rgba(13, 17, 23, 0.98)';
  } else {
    navbar.style.background = 'rgba(13, 17, 23, 0.95)';
  }
});

// Intersection Observer for animations
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

// Observe feature cards
document.querySelectorAll('.feature-card').forEach((card, index) => {
  card.style.opacity = '0';
  card.style.transform = 'translateY(20px)';
  card.style.transition = `all 0.5s ease ${index * 0.1}s`;
  observer.observe(card);
});

// Typewriter effect for code (optional enhancement)
function typeWriter(element, text, speed = 50) {
  let i = 0;
  element.textContent = '';
  
  function type() {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
      setTimeout(type, speed);
    }
  }
  
  type();
}

// Copy code functionality
document.querySelectorAll('.code-panel pre').forEach(pre => {
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    padding: 6px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  `;
  
  copyBtn.addEventListener('click', () => {
    const code = pre.querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.style.color = '#4CAF50';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.style.color = '';
      }, 2000);
    });
  });
  
  pre.style.position = 'relative';
  pre.appendChild(copyBtn);
});

// Console easter egg
console.log('%c🎉 ZenNotif', 'font-size: 24px; font-weight: bold; color: #4CAF50;');
console.log('%cBuilt with empathy for support teams.', 'font-size: 14px; color: #8B949E;');
console.log('%cCheck out the source: https://github.com/username/zennotif', 'font-size: 12px; color: #58A6FF;');
