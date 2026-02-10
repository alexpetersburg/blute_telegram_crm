import json
import os
from datetime import datetime, timezone

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    Message,
    ReplyKeyboardMarkup,
    KeyboardButton,
    WebAppInfo,
)
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ORDERS_CHAT_ID = os.getenv("ORDERS_CHAT_ID", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "")

if not BOT_TOKEN or not ORDERS_CHAT_ID or not WEBAPP_URL:
    raise RuntimeError("Set BOT_TOKEN, ORDERS_CHAT_ID, WEBAPP_URL in env")

dp = Dispatcher()


def money(n: int) -> str:
    return f"{n:,}".replace(",", " ") + " ₽"


@dp.message(CommandStart())
async def start(message: Message, bot: Bot) -> None:
    kb = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="Открыть кассу", web_app=WebAppInfo(url=WEBAPP_URL))]
        ],
        resize_keyboard=True,
        input_field_placeholder="Открой кассу и собери букет",
    )
    await message.answer(
        "Окей. Нажми “Открыть кассу” чтобы посчитать букет и отправить заказ.",
        reply_markup=kb,
    )


@dp.message(F.web_app_data)
async def webapp_order(message: Message, bot: Bot) -> None:
    raw = message.web_app_data.data
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        await message.answer("Не смог прочитать заказ. Попробуй ещё раз.")
        return

    items = payload.get("items", [])
    total = int(payload.get("total", 0))

    if not items or total <= 0:
        await message.answer("Корзина пустая или итог некорректный.")
        return

    user = message.from_user
    who = f"{user.full_name}"
    if user.username:
        who += f" (@{user.username})"

    order_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    lines = []
    lines.append(f"🧾 Заказ #{order_id}")
    lines.append(f"👤 Флорист: {who}")
    lines.append("")

    for it in items:
        name = str(it.get("name", ""))
        qty = int(it.get("qty", 0))
        price = int(it.get("price", 0))
        line_sum = qty * price
        lines.append(f"• {name}: {qty} × {money(price)} = {money(line_sum)}")

    lines.append("")
    lines.append(f"Итог: {money(total)}")

    text = "\n".join(lines)

    await bot.send_message(chat_id=int(ORDERS_CHAT_ID), text=text)
    await message.answer("Заказ отправлен в чат ✅")


async def main() -> None:
    bot = Bot(BOT_TOKEN)
    await dp.start_polling(bot)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
