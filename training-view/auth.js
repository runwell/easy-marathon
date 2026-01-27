/**
 * Training View Authentication Service
 *
 * Handles user authentication and session management for multiple fitness platforms.
 * Stores session data securely in localStorage.
 */

// API Configuration
const API_BASE_URL = 'https://easy-marathon-api.artcmd1.workers.dev';

// localStorage keys
const STORAGE_KEYS = {
    SESSION: 'training_session',
    PLATFORM: 'training_platform',
    USER: 'training_user'
};

/**
 * Authentication Service
 */
export const AuthService = {
    /**
     * Get the API base URL
     */
    getApiUrl() {
        // Allow override for development
        return localStorage.getItem('api_url') || API_BASE_URL;
    },

    /**
     * Check if user is logged in
     */
    isLoggedIn() {
        const session = this.getSession();
        if (!session) return false;

        // Check if session is expired
        if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
            this.logout();
            return false;
        }

        return true;
    },

    /**
     * Get current session
     */
    getSession() {
        try {
            const sessionStr = localStorage.getItem(STORAGE_KEYS.SESSION);
            return sessionStr ? JSON.parse(sessionStr) : null;
        } catch {
            return null;
        }
    },

    /**
     * Get current platform
     */
    getPlatform() {
        return localStorage.getItem(STORAGE_KEYS.PLATFORM);
    },

    /**
     * Get current user display name
     */
    getUserDisplayName() {
        try {
            const userStr = localStorage.getItem(STORAGE_KEYS.USER);
            const user = userStr ? JSON.parse(userStr) : null;
            return user?.displayName || null;
        } catch {
            return null;
        }
    },

    /**
     * Login with credentials
     * @param {string} platform - Platform ID (garmin, strava, coros)
     * @param {Object} credentials - Platform-specific credentials
     */
    async login(platform, credentials) {
        const response = await fetch(`${this.getApiUrl()}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({platform, credentials})
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        // Store session data
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({
            token: data.session.token,
            expiresAt: data.session.expiresAt
        }));
        localStorage.setItem(STORAGE_KEYS.PLATFORM, platform);
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({
            displayName: data.session.displayName
        }));

        return data.session;
    },

    /**
     * Logout current user
     */
    async logout() {
        try {
            // Notify server (optional, for session invalidation)
            const session = this.getSession();
            if (session?.token) {
                await fetch(`${this.getApiUrl()}/api/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.token}`
                    }
                }).catch(() => {
                }); // Ignore errors
            }
        } finally {
            // Clear local storage
            localStorage.removeItem(STORAGE_KEYS.SESSION);
            localStorage.removeItem(STORAGE_KEYS.PLATFORM);
            localStorage.removeItem(STORAGE_KEYS.USER);
        }
    },

    /**
     * Validate current session with server
     */
    async validateSession() {
        const session = this.getSession();
        if (!session?.token) return false;

        try {
            const response = await fetch(`${this.getApiUrl()}/api/auth/validate`, {
                headers: {
                    'Authorization': `Bearer ${session.token}`
                }
            });

            if (!response.ok) {
                this.logout();
                return false;
            }

            return true;
        } catch {
            return false;
        }
    },

    /**
     * Fetch activities for current user
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     */
    async fetchActivities(startDate, endDate) {
        const session = this.getSession();
        if (!session?.token) {
            throw new Error('Not logged in');
        }

        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const response = await fetch(
            `${this.getApiUrl()}/api/activities?${params}`,
            {
                headers: {
                    'Authorization': `Bearer ${session.token}`
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                this.logout();
                throw new Error('Session expired. Please login again.');
            }
            throw new Error(data.error || 'Failed to fetch activities');
        }

        return data.activities;
    },

    /**
     * Get available platforms
     */
    async getPlatforms() {
        try {
            const response = await fetch(`${this.getApiUrl()}/api/platforms`);
            const data = await response.json();
            return data.platforms || [];
        } catch {
            // Return default list if API is unavailable
            return [
                {id: 'garmin', name: 'Garmin Connect', supported: true, hasOAuth: false},
                {id: 'strava', name: 'Strava', supported: false, hasOAuth: true},
                {id: 'coros', name: 'Coros', supported: false, hasOAuth: false}
            ];
        }
    }
};

/**
 * Login Modal UI Component
 */
export const LoginModal = {
    modalElement: null,

    /**
     * Create and show the login modal
     */
    show() {
        if (this.modalElement) {
            this.modalElement.classList.add('open');
            return;
        }

        this.modalElement = document.createElement('div');
        this.modalElement.className = 'auth-modal-overlay';
        this.modalElement.innerHTML = `
      <div class="auth-modal">
        <div class="auth-modal-header">
          <h2>Connect Your Account</h2>
          <button class="auth-close-btn" aria-label="Close">&times;</button>
        </div>
        
        <div class="auth-modal-body">
          <!-- Platform Selection -->
          <div class="auth-step" id="auth-step-platform">
            <p class="auth-subtitle">Select your fitness platform</p>
            <div class="platform-buttons" id="platform-buttons">
              <!-- Platforms will be populated dynamically -->
            </div>
          </div>
          
          <!-- Credentials Form -->
          <div class="auth-step hidden" id="auth-step-credentials">
            <button class="auth-back-btn" id="auth-back-btn">&larr; Back</button>
            <p class="auth-subtitle">Enter your <span id="platform-name">Garmin</span> credentials</p>
            
            <form id="auth-credentials-form">
              <div class="auth-form-group">
                <label for="auth-email">Email</label>
                <input type="email" id="auth-email" required placeholder="your@email.com">
              </div>
              
              <div class="auth-form-group">
                <label for="auth-password">Password</label>
                <input type="password" id="auth-password" required placeholder="Your password">
              </div>
              
              <div class="auth-error hidden" id="auth-error"></div>
              
              <button type="submit" class="auth-submit-btn" id="auth-submit-btn">
                <span class="btn-text">Sign In</span>
                <span class="btn-loading hidden">Signing in...</span>
              </button>
            </form>
            
            <p class="auth-note">
              Your credentials are sent securely to our server for authentication.
              We do not store your password.
            </p>
          </div>
        </div>
      </div>
    `;

        document.body.appendChild(this.modalElement);
        this.setupEventListeners();
        this.loadPlatforms();

        // Show modal with animation
        requestAnimationFrame(() => {
            this.modalElement.classList.add('open');
        });
    },

    /**
     * Hide the login modal
     */
    hide() {
        if (this.modalElement) {
            this.modalElement.classList.remove('open');
            // Reset to platform selection
            setTimeout(() => {
                this.showStep('platform');
            }, 300);
        }
    },

    /**
     * Remove the modal from DOM
     */
    destroy() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    },

    /**
     * Show a specific step
     */
    showStep(step) {
        const platformStep = document.getElementById('auth-step-platform');
        const credentialsStep = document.getElementById('auth-step-credentials');

        if (step === 'platform') {
            platformStep.classList.remove('hidden');
            credentialsStep.classList.add('hidden');
        } else {
            platformStep.classList.add('hidden');
            credentialsStep.classList.remove('hidden');
        }
    },

    /**
     * Load available platforms
     */
    async loadPlatforms() {
        const container = document.getElementById('platform-buttons');
        if (!container) return;

        const platforms = await AuthService.getPlatforms();

        container.innerHTML = platforms.map(platform => `
      <button class="platform-btn ${!platform.supported ? 'disabled' : ''}" 
              data-platform="${platform.id}"
              ${!platform.supported ? 'disabled' : ''}>
        <span class="platform-icon">${this.getPlatformIcon(platform.id)}</span>
        <span class="platform-name">${platform.name}</span>
        ${!platform.supported ? '<span class="platform-badge">Coming Soon</span>' : ''}
      </button>
    `).join('');
    },

    /**
     * Get platform icon
     */
    getPlatformIcon(platformId) {
        const icons = {
            garmin: '⌚',
            strava: '🏃',
            coros: '📍'
        };
        return icons[platformId] || '🔗';
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Close button
        const closeBtn = this.modalElement.querySelector('.auth-close-btn');
        closeBtn?.addEventListener('click', () => this.hide());

        // Click outside to close
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) this.hide();
        });

        // Platform selection
        const platformBtns = this.modalElement.querySelector('#platform-buttons');
        platformBtns?.addEventListener('click', (e) => {
            const btn = e.target.closest('.platform-btn');
            if (btn && !btn.disabled) {
                this.selectedPlatform = btn.dataset.platform;
                document.getElementById('platform-name').textContent = btn.querySelector('.platform-name').textContent;
                this.showStep('credentials');
            }
        });

        // Back button
        const backBtn = document.getElementById('auth-back-btn');
        backBtn?.addEventListener('click', () => this.showStep('platform'));

        // Form submission
        const form = document.getElementById('auth-credentials-form');
        form?.addEventListener('submit', (e) => this.handleLogin(e));
    },

    /**
     * Handle login form submission
     */
    async handleLogin(e) {
        e.preventDefault();

        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const submitBtn = document.getElementById('auth-submit-btn');
        const errorDiv = document.getElementById('auth-error');

        // Show loading state
        submitBtn.disabled = true;
        submitBtn.querySelector('.btn-text').classList.add('hidden');
        submitBtn.querySelector('.btn-loading').classList.remove('hidden');
        errorDiv.classList.add('hidden');

        try {
            await AuthService.login(this.selectedPlatform, {email, password});

            // Success - close modal and refresh
            this.hide();

            // Trigger custom event for parent to handle
            window.dispatchEvent(new CustomEvent('auth:login', {
                detail: {platform: this.selectedPlatform}
            }));

        } catch (error) {
            // Show error
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        } finally {
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.querySelector('.btn-text').classList.remove('hidden');
            submitBtn.querySelector('.btn-loading').classList.add('hidden');
        }
    },

    selectedPlatform: null
};

/**
 * User Menu UI Component
 */
export const UserMenu = {
    /**
     * Create the user menu element
     */
    create() {
        const menu = document.createElement('div');
        menu.className = 'user-menu';
        menu.id = 'user-menu';

        if (AuthService.isLoggedIn()) {
            const displayName = AuthService.getUserDisplayName() || 'User';
            const platform = AuthService.getPlatform();

            menu.innerHTML = `
        <div class="user-info">
          <span class="user-platform">${this.getPlatformIcon(platform)}</span>
          <span class="user-name">${displayName}</span>
        </div>
        <button class="user-sync-btn" id="sync-btn">Sync</button>
        <button class="user-logout-btn" id="logout-btn">Logout</button>
      `;
        } else {
            menu.innerHTML = `
        <button class="user-login-btn" id="login-btn">Sign In</button>
      `;
        }

        return menu;
    },

    /**
     * Get platform icon
     */
    getPlatformIcon(platformId) {
        const icons = {
            garmin: '⌚',
            strava: '🏃',
            coros: '📍'
        };
        return icons[platformId] || '🔗';
    },

    /**
     * Setup event listeners for the menu
     */
    setup() {
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');
        const syncBtn = document.getElementById('sync-btn');

        loginBtn?.addEventListener('click', () => LoginModal.show());
        syncBtn?.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('activities:sync'));
        });

        logoutBtn?.addEventListener('click', async () => {
            await AuthService.logout();
            window.dispatchEvent(new CustomEvent('auth:logout'));
        });
    }
};
