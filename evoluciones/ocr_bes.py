#!/usr/bin/env python3
import sys, json, re
from PIL import Image
import pytesseract

def extraer_datos(img_path):
    img = Image.open(img_path)
    # Escalar para mejor OCR
    w, h = img.size
    img = img.resize((w*2, h*2), Image.LANCZOS)
    
    texto = pytesseract.image_to_string(img, lang='spa+eng', config='--psm 6')
    
    datos = {}
    
    # IMEI — 15 dígitos
    imei = re.search(r'\b(\d{15})\b', texto)
    datos['imei'] = imei.group(1) if imei else 'No aplica'
    
    # ICCID — empieza con 8952, ~19-20 dígitos
    iccid = re.search(r'\b(8952\d{15,16})\b', texto)
    datos['iccid'] = iccid.group(1) if iccid else ''
    
    # Número celular — 10 dígitos que empieza con 55,56,33,81,etc
    numero = re.search(r'\b([2-9][1-9]\d{8})\b', texto)
    datos['numero_celular'] = numero.group(1) if numero else ''
    
    # Producto — buscar línea con "producto" o "plan"
    prod = re.search(r'(?:producto|plan|amigo)[:\s]+([^\n]+)', texto, re.IGNORECASE)
    datos['producto'] = prod.group(1).strip()[:40] if prod else ''
    
    datos['texto_raw'] = texto[:500]
    
    print(json.dumps(datos, ensure_ascii=False))

if __name__ == '__main__':
    extraer_datos(sys.argv[1])
