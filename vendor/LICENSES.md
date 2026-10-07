# Bundled third-party code

| Where | Package | Version | Licence |
| --- | --- | --- | --- |
| `vendor/flask-bundle.zip` | Flask | 3.1.3 | BSD-3-Clause |
| | Werkzeug | 3.1.8 | BSD-3-Clause |
| | Jinja2 | 3.1.6 | BSD-3-Clause |
| | MarkupSafe | 3.0.3 | BSD-3-Clause |
| | itsdangerous | 2.2.0 | BSD-3-Clause |
| | click | 8.5.0 | BSD-3-Clause |
| | blinker | 1.9.0 | MIT |
| `frontend/js/vendor/qrcode.js` | QRCode for JavaScript (Kazuhiko Arase) | 2009 | MIT |

The full licence texts are inside the zip under `licenses/`, and at the top of `qrcode.js`.

`flask-bundle.zip` holds the unmodified, pure-Python package sources (no compiled files), plus an empty
`flask/sansio/__init__.py` so Python can import the folder from a zip. Rebuild it with `tools/build_vendor.py`.
If Flask is already installed (`pip install -r requirements.txt`), the app uses that copy instead.

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
