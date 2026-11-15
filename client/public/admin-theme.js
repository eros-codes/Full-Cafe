/* The admin panel's theme, set before the page draws (no flash of the other theme). Loaded by the panel's and
   the login page's index.html; the button in the panel (client/admin/common/theme.ts) saves the choice. */
(function () {
	try {
		var theme = localStorage.getItem('admin-theme');
		if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
	} catch (error) {
		/* storage blocked: the device's theme */
	}
})();
