/* The «چاپ» button of the QR sheet (/admin/table-qr): scripts written into the page are blocked by the site's
   security rules, so the click is wired from this file. */
document.addEventListener('DOMContentLoaded', function () {
	var button = document.getElementById('printSheet');
	if (button) button.addEventListener('click', function () { window.print(); });
});
