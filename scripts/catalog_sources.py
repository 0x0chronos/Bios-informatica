"""Categorias p?blicas e marcas do cat?logo de hardware."""
BRANDS = [
    "ASUS", "GIGABYTE", "MSI", "ASROCK", "AMD", "INTEL", "NVIDIA", "CORSAIR",
    "KINGSTON", "XPG", "ADATA", "CRUCIAL", "GALAX", "PNY", "PALIT", "INNO3D",
    "PCYES", "MANCER", "PICHAU", "SUPERFRAME", "REDRAGON", "DEEPCOOL", "COOLER MASTER",
    "THERMALRIGHT", "MONTECH", "RISE MODE", "HUSKY", "SAMSUNG", "WESTERN DIGITAL", "SEAGATE",
    "LOGITECH", "RAZER", "TGT", "AOC", "LG", "ACER", "DELL", "GAMEMAX", "COUGAR"
]

DEPARTMENTS = {
    "Processador": {
        "kabum": "https://www.kabum.com.br/hardware/processadores?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/hardware/processadores?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/processadores?page={page}"
    },
    "Placa de Vídeo": {
        "kabum": "https://www.kabum.com.br/hardware/placa-de-video-vga?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/hardware/placas-de-video?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/placa-de-video?page={page}"
    },
    "Placa-Mãe": {
        "kabum": "https://www.kabum.com.br/hardware/placas-mae?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/hardware/placas-mae?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/placa-m-e?page={page}"
    },
    "Memória RAM": {
        "kabum": "https://www.kabum.com.br/hardware/memoria-ram?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/hardware/memorias?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/memorias?page={page}"
    },
    "Armazenamento / SSD": {
        "kabum": "https://www.kabum.com.br/hardware/ssd-2-5?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/hardware/hard-disk/ssd?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/ssd?page={page}"
    },
    "Fonte": {
        "kabum": "https://www.kabum.com.br/hardware/fontes?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/fontes?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/fonte?page={page}"
    },
    "Gabinete": {
        "kabum": "https://www.kabum.com.br/perifericos/gabinetes?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/gabinetes?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/gabinete?page={page}"
    },
    "Refrigeração / Cooler": {
        "kabum": "https://www.kabum.com.br/hardware/coolers?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/refrigeracao?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/cooler-processador?page={page}"
    },
    "Periféricos & Monitores": {
        "kabum": "https://www.kabum.com.br/computadores/monitores?page_number={page}&page_size=100",
        "terabyte": "https://www.terabyteshop.com.br/monitores?pagina={page}",
        "pichau": "https://www.pichau.com.br/monitores?page={page}"
    }
}
