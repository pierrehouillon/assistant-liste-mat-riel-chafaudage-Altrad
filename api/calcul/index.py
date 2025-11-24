from fastapi import FastAPI
from pydantic import BaseModel
import math
import json
import os

app = FastAPI()

# Charger les données (désignations, etc.)
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "references.json")
with open(DATA_PATH, "r", encoding="utf-8") as f:
    REF_DATA = json.load(f)


class EchafaudageRequest(BaseModel):
    L: float
    H: float
    largeur: float
    F: int
    protection_mur: str
    grutage: str
    stabilisation: str
    cales_plastiques: str


@app.post("/")
def calcul(req: EchafaudageRequest):

    L = req.L
    H = req.H
    largeur = req.largeur
    F = req.F
    protection_mur = req.protection_mur.upper() == "OUI"
    grutage = req.grutage.upper() == "OUI"
    cales_plastiques = req.cales_plastiques.upper() == "OUI"
    stabilisation = req.stabilisation.lower()

    # Travées & niveaux
    T = math.ceil(L / 2.5)
    N = math.ceil(H / 2.0)

    # SOCLES / POTEAUX
    ALTASV5 = 2*T + 2
    ALTKEMB12 = ALTASV5
    ALTKPT2 = ALTASV5
    ALTKPT4 = ALTASV5 * N

    # LISSES
    ALTKLC1 = 2 * T * N if abs(largeur - 0.70) < 1e-6 else 0
    ALTKLC2 = 2 * T * N if abs(largeur - 1.00) < 1e-6 else 0
    ALTKLC5 = (2*T + 2*N) if protection_mur else (2*T + N)

    # PLANCHERS
    base = 2 * T * N
    corr_largeur = N if abs(largeur - 1.00) < 1e-6 else 0
    corr_mur = 2 if protection_mur else 0
    ALTKMC5 = base + corr_largeur - corr_mur

    nb_trappes = math.ceil(L / 20)
    ALTKPE5 = F * N * nb_trappes

    # DIAGONALES
    ALTKDV5 = (2*F) if protection_mur else (1*F)

    # GARDE-CORPS
    ALTKGH5 = (2*T*N) if protection_mur else (T*N)
    ALTKGH1 = 2*N if abs(largeur - 0.70) < 1e-6 else 0
    ALTKGH2 = 2*N if abs(largeur - 1.00) < 1e-6 else 0

    # PLINTHES
    ALTKPI5 = 2 * T * N

    # STABILISATEURS
    ALT000675 = (T + 1) if (stabilisation == "stabilisateurs" and H <= 6) else 0
    ALTAMX1 = ALTASV5 + ALT000675
    ALTACPI = (ALTASV5 + ALT000675) if cales_plastiques else 0

    # AMARRAGE
    POINTS = math.ceil((L * H) / 12) if stabilisation == "amarrage" else 0
    ALTAA11 = POINTS
    ALTAPA2 = POINTS
    ALTL99P = POINTS

    # GRUTAGE
    ALTRLEV = 4 if grutage else 0
    ALTKB12 = ALTKPT4 if grutage else 0
    ALTKB13 = ALTKEMB12 if grutage else 0
    ALTKFSV = ALTASV5 if grutage else 0

    # Résultats
    quantites = {
        "ALTASV5": ALTASV5,
        "ALTKEMB12": ALTKEMB12,
        "ALTKPT2": ALTKPT2,
        "ALTKPT4": ALTKPT4,
        "ALTKLC1": ALTKLC1,
        "ALTKLC2": ALTKLC2,
        "ALTKLC5": ALTKLC5,
        "ALTKMC5": ALTKMC5,
        "ALTKPE5": ALTKPE5,
        "ALTKDV5": ALTKDV5,
        "ALTKGH5": ALTKGH5,
        "ALTKGH1": ALTKGH1,
        "ALTKGH2": ALTKGH2,
        "ALTKPI5": ALTKPI5,
        "ALT000675": ALT000675,
        "ALTAMX1": ALTAMX1,
        "ALTACPI": ALTACPI,
        "ALTAA11": ALTAA11,
        "ALTAPA2": ALTAPA2,
        "ALTL99P": ALTL99P,
        "ALTRLEV": ALTRLEV,
        "ALTKB12": ALTKB12,
        "ALTKB13": ALTKB13,
        "ALTKFSV": ALTKFSV,
    }

    rows = []
    for ref, qte in quantites.items():
        if qte > 0:
            rows.append({
                "reference": ref,
                "designation": REF_DATA.get(ref, ""),
                "quantite": qte
            })

    return {"items": rows}
