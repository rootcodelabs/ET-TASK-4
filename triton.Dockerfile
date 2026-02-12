# Optimized Triton Inference Server for Whisper STT
FROM nvcr.io/nvidia/tritonserver:24.08-py3

# Environment setup
ENV PIP_DEFAULT_TIMEOUT=1000 \
    PYTHONUNBUFFERED=1 \
    CUDA_VISIBLE_DEVICES=0 \
    DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Upgrade pip
RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel

# Install PyTorch with CUDA support first
RUN python3 -m pip install --no-cache-dir \
    torch==2.1.2 \
    torchaudio==2.1.2 \
    --index-url https://download.pytorch.org/whl/cu121

# Copy requirements file and install remaining dependencies from PyPI
COPY triton_models/requirements.txt /tmp/requirements.txt
RUN python3 -m pip install --no-cache-dir -r /tmp/requirements.txt && \
    rm -rf /tmp/*

# Create directories
RUN mkdir -p /models /logs /workspace

WORKDIR /workspace

# Expose ports
EXPOSE 8000 8001 8002

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=90s \
    CMD curl -f http://localhost:8000/v2/health/ready || exit 1

# Start Triton
CMD ["tritonserver", \
     "--model-repository=/models", \
     "--log-verbose=1", \
     "--allow-http=true", \
     "--allow-grpc=true", \
     "--http-port=8000", \
     "--grpc-port=8001", \
     "--metrics-port=8002", \
     "--strict-model-config=false", \
     "--backend-config=python,shm-default-byte-size=16777216", \
     "--backend-config=python,stub-timeout-seconds=120"]