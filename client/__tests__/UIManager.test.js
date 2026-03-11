/**
 * UIManager Tests
 * Tests for media not found dialog functionality
 */

describe('UIManager - Media Not Found Dialog', () => {
  let UIManager;
  let container;

  beforeEach(() => {
    // Create a container for the UI
    container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);

    // Clear any existing modals
    const existing = document.getElementById('media-not-found-modal');
    if (existing) existing.remove();

    // Load UIManager
    require('../js/UIManager.js');
    UIManager = window.UIManager;
  });

  afterEach(() => {
    // Clean up
    const modal = document.getElementById('media-not-found-modal');
    if (modal) modal.remove();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('showMediaNotFoundDialog', () => {
    test('should create modal overlay element', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      expect(modal).toBeTruthy();
      expect(modal.tagName).toBe('DIV');
    });

    test('should have correct modal class and active state', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      expect(modal.className).toContain('modal-overlay');
      expect(modal.className).toContain('active');
    });

    test('should have dialog title "No Media Devices Found"', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      expect(modal.textContent).toContain('No Media Devices Found');
    });

    test('should have Retry button', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      const retryBtn = Array.from(modal.querySelectorAll('button'))
        .find(b => b.textContent === 'Retry');
      expect(retryBtn).toBeTruthy();
    });

    test('should have Continue Without Media button', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      const continueBtn = Array.from(modal.querySelectorAll('button'))
        .find(b => b.textContent === 'Continue Without Media');
      expect(continueBtn).toBeTruthy();
    });

    test('should have Enable Test Mode button', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      const testModeBtn = Array.from(modal.querySelectorAll('button'))
        .find(b => b.textContent === 'Enable Test Mode');
      expect(testModeBtn).toBeTruthy();
    });

    test('should call onRetry callback when Retry button is clicked', () => {
      const onRetry = jest.fn();
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(onRetry, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      const retryBtn = Array.from(modal.querySelectorAll('button'))
        .find(b => b.textContent === 'Retry');

      retryBtn.click();

      expect(onRetry).toHaveBeenCalledTimes(1);
      // Modal should be removed after click
      expect(document.getElementById('media-not-found-modal')).toBeFalsy();
    });

    test('should call onContinueWithoutMedia callback when button is clicked', () => {
      const onContinue = jest.fn();
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, onContinue, () => {});

      const modal = document.getElementById('media-not-found-modal');
      const continueBtn = Array.from(modal.querySelectorAll('button'))
        .find(b => b.textContent === 'Continue Without Media');

      continueBtn.click();

      expect(onContinue).toHaveBeenCalledTimes(1);
      expect(document.getElementById('media-not-found-modal')).toBeFalsy();
    });

    test('should call onEnableTestMode callback when button is clicked', () => {
      const onEnableTestMode = jest.fn();
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, onEnableTestMode);

      const modal = document.getElementById('media-not-found-modal');
      const testModeBtn = Array.from(modal.querySelectorAll('button'))
        .find(b => b.textContent === 'Enable Test Mode');

      testModeBtn.click();

      expect(onEnableTestMode).toHaveBeenCalledTimes(1);
      expect(document.getElementById('media-not-found-modal')).toBeFalsy();
    });

    test('should remove existing modal before creating new one', () => {
      const uiManager = new UIManager();

      // Create first modal
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});
      const firstModalId = 'media-not-found-modal';

      // Create second modal
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});
      const secondModal = document.getElementById('media-not-found-modal');

      // First modal should be removed (check by ID)
      const firstModalNow = document.getElementById(firstModalId);
      // Should only have one modal (the second one)
      expect(firstModalNow).toBe(secondModal);
      expect(document.querySelectorAll('#media-not-found-modal').length).toBe(1);
    });

    test('should display list of options', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      const listItems = modal.querySelectorAll('li');

      expect(listItems.length).toBe(3);
      expect(modal.textContent).toContain('Retry device detection');
      expect(modal.textContent).toContain('Continue in view-only mode');
      expect(modal.textContent).toContain('Enable test mode');
    });

    test('should display tip about URL parameter', () => {
      const uiManager = new UIManager();
      uiManager.showMediaNotFoundDialog(() => {}, () => {}, () => {});

      const modal = document.getElementById('media-not-found-modal');
      expect(modal.textContent).toContain('?testMode=true');
    });
  });
});
