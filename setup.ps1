# to run - .\setup.ps1

Write-Host "Setting up Admin-IT environment..." -ForegroundColor Cyan

# Create virtual environment
python -m venv venv

# Activate
.\venv\Scripts\Activate.ps1

# Upgrade pip
python -m pip install --upgrade pip

# Install backend requirements
pip install -r backend\requirements.txt

Write-Host "Setup complete!" -ForegroundColor Green
