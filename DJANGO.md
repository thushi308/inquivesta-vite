# Serving this frontend from Django

Project layout (example):

```
myproject/
├── manage.py
├── myproject/        (settings.py, urls.py)
└── frontend/         <- this folder
    └── dist/         <- created by `npm run build`
```

## 1. settings.py

```python
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent

STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "frontend" / "dist"]   # hashed JS/CSS/images from Vite
STATIC_ROOT = BASE_DIR / "staticfiles"                # for `collectstatic` in production

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "frontend" / "dist"],         # so Django can find dist/index.html
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
```

## 2. urls.py

```python
from django.urls import path
from django.views.generic import TemplateView

urlpatterns = [
    # ... your /api/ and /admin/ routes first ...
    path("", TemplateView.as_view(template_name="index.html")),
]
```

## 3. Build and run

```bash
cd frontend
npm install
npm run assets     # downloads Figma images into public/images (links expire ~7 days)
npm run build      # outputs frontend/dist (assets are referenced as /static/assets/...)
cd ..
python manage.py runserver        # production: also run `python manage.py collectstatic`
```

## Developing with hot reload

Run both servers: `python manage.py runserver` (port 8000) and `npm run dev` (port 5173).
Open http://localhost:5173. Requests to `/api/...` are proxied to Django, so no CORS setup is needed.

## Notes

- Same domain = Django sessions and CSRF work normally. For POST requests send the `X-CSRFToken` header
  (read the `csrftoken` cookie).
- Serve large video/image files from nginx or a CDN in production instead of through Django.
