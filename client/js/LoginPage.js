/**
 * LoginPage - Handles user login for BreadCall
 * Provides form-based authentication with role-based redirect logic
 */
class LoginPage {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoading = false;
    this.init();
  }

  async init() {
    // Check if already logged in, redirect if so
    const isAuthenticated = await window.authService.init();
    if (isAuthenticated) {
      const user = window.authService.getCurrentUser();
      if (user) {
        this.redirectBasedOnRole(user);
        return;
      }
    }

    this.render();
    this.attachEventListeners();
  }

  /**
   * Render the login page using safe DOM methods
   */
  render() {
    // Create main container
    const loginPage = document.createElement('div');
    loginPage.className = 'login-page';

    const loginContainer = document.createElement('div');
    loginContainer.className = 'login-container';

    const loginBox = document.createElement('div');
    loginBox.className = 'login-box';

    // Header
    const loginHeader = document.createElement('div');
    loginHeader.className = 'login-header';

    const loginLogo = document.createElement('h1');
    loginLogo.className = 'login-logo';
    loginLogo.textContent = 'BreadCall';

    const loginSubtitle = document.createElement('p');
    loginSubtitle.className = 'login-subtitle';
    loginSubtitle.textContent = 'Sign in to your account';

    loginHeader.appendChild(loginLogo);
    loginHeader.appendChild(loginSubtitle);

    // Form
    const form = document.createElement('form');
    form.id = 'login-form';
    form.className = 'login-form';

    // Username field
    const usernameGroup = document.createElement('div');
    usernameGroup.className = 'form-group';

    const usernameLabel = document.createElement('label');
    usernameLabel.setAttribute('for', 'username');
    usernameLabel.textContent = 'Username';

    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.id = 'username';
    usernameInput.name = 'username';
    usernameInput.placeholder = 'Enter your username';
    usernameInput.required = true;
    usernameInput.autocomplete = 'username';

    usernameGroup.appendChild(usernameLabel);
    usernameGroup.appendChild(usernameInput);

    // Password field
    const passwordGroup = document.createElement('div');
    passwordGroup.className = 'form-group';

    const passwordLabel = document.createElement('label');
    passwordLabel.setAttribute('for', 'password');
    passwordLabel.textContent = 'Password';

    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.id = 'password';
    passwordInput.name = 'password';
    passwordInput.placeholder = 'Enter your password';
    passwordInput.required = true;
    passwordInput.autocomplete = 'current-password';

    passwordGroup.appendChild(passwordLabel);
    passwordGroup.appendChild(passwordInput);

    // Error message container
    const errorMessage = document.createElement('div');
    errorMessage.id = 'error-message';
    errorMessage.className = 'error-message hidden';

    // Submit button
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.id = 'login-button';
    submitButton.className = 'btn btn-primary login-button';

    const buttonText = document.createElement('span');
    buttonText.className = 'button-text';
    buttonText.textContent = 'Sign In';

    const buttonSpinner = document.createElement('span');
    buttonSpinner.className = 'button-spinner hidden';

    const spinner = document.createElement('span');
    spinner.className = 'spinner spinner-sm';

    buttonSpinner.appendChild(spinner);
    submitButton.appendChild(buttonText);
    submitButton.appendChild(buttonSpinner);

    // Assemble form
    form.appendChild(usernameGroup);
    form.appendChild(passwordGroup);
    form.appendChild(errorMessage);
    form.appendChild(submitButton);

    // Links
    const loginLinks = document.createElement('div');
    loginLinks.className = 'login-links';

    const joinLink = document.createElement('a');
    joinLink.href = '/';
    joinLink.className = 'link-join';
    joinLink.textContent = 'Join as viewer/participant';

    loginLinks.appendChild(joinLink);

    // Assemble login box
    loginBox.appendChild(loginHeader);
    loginBox.appendChild(form);
    loginBox.appendChild(loginLinks);

    loginContainer.appendChild(loginBox);
    loginPage.appendChild(loginContainer);

    // Clear and append to app
    this.appElement.innerHTML = '';
    this.appElement.appendChild(loginPage);
  }

  /**
   * Attach event listeners to form elements
   */
  attachEventListeners() {
    const form = document.getElementById('login-form');
    form.addEventListener('submit', (e) => this.handleSubmit(e));

    // Clear error message on input
    const inputs = form.querySelectorAll('input');
    inputs.forEach(input => {
      input.addEventListener('input', () => this.hideError());
    });
  }

  /**
   * Handle form submission
   * @param {Event} e - Form submit event
   */
  async handleSubmit(e) {
    e.preventDefault();

    if (this.isLoading) return;

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
      this.showError('Please enter both username and password');
      return;
    }

    this.setLoading(true);

    try {
      const result = await window.authService.login(username, password);

      if (result.success && result.user) {
        console.log('[LoginPage] Login successful, user:', result.user);
        // Small delay to ensure cookies are set before redirect
        await new Promise(resolve => setTimeout(resolve, 50));
        this.redirectBasedOnRole(result.user);
      } else {
        this.showError(result.error || 'Invalid credentials');
        this.setLoading(false);
      }
    } catch (error) {
      console.error('[LoginPage] Login error:', error);
      this.showError('Connection error. Please try again.');
      this.setLoading(false);
    }
  }

  /**
   * Redirect user to appropriate dashboard based on their role
   * @param {Object} user - User object with role property
   */
  redirectBasedOnRole(user) {
    if (!user || !user.role) {
      // Default redirect if no role specified
      window.location.href = '/';
      return;
    }

    const roleRedirects = {
      'admin': '/admin',
      'director': '/director-dashboard',
      'operator': '/monitoring'
    };

    const redirectUrl = roleRedirects[user.role] || '/';
    console.log('[LoginPage] Redirecting to:', redirectUrl, 'for role:', user.role);
    window.location.href = redirectUrl;
  }

  /**
   * Set loading state for the login button
   * @param {boolean} loading - Whether to show loading state
   */
  setLoading(loading) {
    this.isLoading = loading;
    const button = document.getElementById('login-button');
    const buttonText = button.querySelector('.button-text');
    const buttonSpinner = button.querySelector('.button-spinner');

    if (loading) {
      button.disabled = true;
      buttonText.classList.add('hidden');
      buttonSpinner.classList.remove('hidden');
    } else {
      button.disabled = false;
      buttonText.classList.remove('hidden');
      buttonSpinner.classList.add('hidden');
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message to display
   */
  showError(message) {
    const errorElement = document.getElementById('error-message');
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
  }

  /**
   * Hide error message
   */
  hideError() {
    const errorElement = document.getElementById('error-message');
    errorElement.classList.add('hidden');
    errorElement.textContent = '';
  }
}

// Initialize login page when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.loginPage = new LoginPage();
  });
} else {
  window.loginPage = new LoginPage();
}
