"""
Парсер коэффициентов pari.ru
Установка: pip install requests
Запуск:    python pari_odds.py
"""

import requests
import json

# ─── настройки ────────────────────────────────────────────────
EVENT_ID   = "64971503"   # ID матча из URL pari.ru/sports/football/136181/64971503
SCOPE      = "2300"
API_HOST   = "https://line-lb01-w.pb06e2-resources.com"
# ──────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://pari.ru/",
    "Accept": "application/json",
}

def get_version():
    """Получаем свежий version из первого запроса к event"""
    url = f"{API_HOST}/events/event"
    r = requests.get(url, params={
        "lang": "ru",
        "version": "0",
        "eventId": EVENT_ID,
        "scopeMarket": SCOPE,
    }, headers=HEADERS, timeout=15)
    data = r.json()
    version = data.get("packetVersion") or data.get("fromVersion")
    print(f"version: {version}")
    return str(version)

def get_list(version):
    url = f"{API_HOST}/events/list"
    r = requests.get(url, params={
        "lang": "ru",
        "version": version,
        "scopeMarket": SCOPE,
    }, headers=HEADERS, timeout=15)
    return r.json()

def find_event(data, event_id):
    """Ищем наш матч в customFactors"""
    factors = data.get("customFactors", [])
    for item in factors:
        if str(item.get("e")) == event_id:
            return item
    return None

def parse_factors(item):
    """Разбираем коэффициенты из объекта события"""
    results = []
    factors = item.get("f", [])  # f = factors (список исходов)
    for f in factors:
        # Типичная структура: {n: "название", v: 1.85, ...}
        name = f.get("n") or f.get("name") or str(f.get("t", ""))
        value = f.get("v") or f.get("value") or f.get("price")
        if value:
            try:
                results.append({"outcome": name, "odds": float(value)})
            except (TypeError, ValueError):
                pass
    return results

def main():
    print("=== Парсер коэффициентов pari.ru ===\n")

    # Шаг 1 — получаем version
    try:
        version = get_version()
    except Exception as e:
        print(f"Не удалось получить version: {e}")
        # Можно вставить вручную из браузера:
        version = "78770382289"
        print(f"Использую захардкоженный version: {version}")

    # Шаг 2 — загружаем список
    print("Загружаю данные...")
    data = get_list(version)

    # Сохраняем сырой ответ
    with open("pari_raw.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Сырой ответ сохранён в pari_raw.json")

    # Шаг 3 — ищем наш матч
    event = find_event(data, EVENT_ID)
    if not event:
        print(f"\nМатч {EVENT_ID} не найден в ответе.")
        print("Открой pari_raw.json и посмотри структуру — сообщи мне.")
        return

    print(f"\nМатч найден! countAll={event.get('countAll')} исходов\n")

    # Шаг 4 — парсим коэффициенты
    odds = parse_factors(event)

    if odds:
        print(f"{'Исход':<40} {'Коэф':>6}")
        print("-" * 48)
        for o in odds:
            print(f"{o['outcome']:<40} {o['odds']:>6.2f}")
    else:
        # Структура может отличаться — выводим сырой объект матча
        print("Коэффициенты не распознаны автоматически.")
        print("Сырой объект матча:")
        print(json.dumps(event, ensure_ascii=False, indent=2))

    # Сохраняем результат
    with open("pari_odds_result.json", "w", encoding="utf-8") as f:
        json.dump({"event_id": EVENT_ID, "odds": odds, "raw_event": event},
                  f, ensure_ascii=False, indent=2)
    print("\nРезультат сохранён в pari_odds_result.json")

if __name__ == "__main__":
    main()
