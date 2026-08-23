"""Expand the checked-in demo catalog to 1,000 customers with realistic activity.

Keeps the curated first 51 profiles/scenarios, adds a deterministic long tail,
and creates multi-day activity. Twenty customers (2%) are fully dormant; other
customers intentionally omit one or more channels to model channel dormancy.
"""
from __future__ import annotations
import json, random, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
random.seed(20260821)
# Anchored to the actual moment this script runs (not a fixed date) so the
# 3/7/14/30-day dashboard filters stay populated no matter when the demo
# happens. Re-run this script the morning of a demo to refresh the window.
NOW = datetime.now(timezone.utc)
FIRST_NAMES = ["Aarav","Aditi","Akash","Ananya","Arjun","Diya","Ishaan","Kavya","Meera","Neha","Nikhil","Priya","Rahul","Riya","Rohan","Saanvi","Siddharth","Tanvi","Varun","Vikram"]
LAST_NAMES = ["Agarwal","Bose","Chatterjee","Desai","Gupta","Iyer","Jain","Kapoor","Khan","Kulkarni","Mehta","Menon","Nair","Patel","Rao","Reddy","Shah","Sharma","Singh","Verma"]
CHANNEL_EVENTS = {
    "web": ["page_view", "login_success", "product_view", "add_to_cart", "payment_attempt", "payment_success"],
    "mobile_app": ["app_open", "login_success", "product_view", "payment_attempt", "payment_success"],
    "call_center": ["call_initiated", "call_connected", "agent_handoff", "call_ended"],
    "branch": ["branch_enter", "queue_join", "agent_service", "transaction", "branch_exit"],
}

def device(): return f"d-{uuid.uuid4().hex[:12]}"
def event_id(): return f"ev-{uuid.uuid4().hex[:12]}"

def main():
    customers = json.loads((DATA / "customers.json").read_text())[:51]
    curated_ids = {c["customer_id"] for c in customers}
    cities = [("Mumbai","Maharashtra",[19.076,72.8777],"103.21.45"),("Delhi","Delhi",[28.6139,77.209],"49.36.112"),("Bangalore","Karnataka",[12.9716,77.5946],"49.207.45"),("Chennai","Tamil Nadu",[13.0827,80.2707],"124.123.45"),("Hyderabad","Telangana",[17.385,78.4867],"49.205.45")]
    for idx in range(52, 1001):
        name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"; city,state,geo,subnet = random.choice(cities)
        fully_dormant = idx > 980
        available = [] if fully_dormant else random.sample(list(CHANNEL_EVENTS), k=random.choices([1,2,3,4],[12,38,38,12])[0])
        customers.append({
            "customer_id": f"C{idx:04d}", "name": name,
            "email": f"{name.lower().replace(' ','.').replace("'",'')}{idx}@example.com",
            "phone_e164": "+91" + str(random.randint(6000000000,9999999999)), "loyalty_card": f"LC{idx:08d}",
            "age": random.randint(21,75), "gender": random.choice(["M","F","Other"]), "city": city, "state": state,
            "home_geo": geo, "primary_device_fp": device(), "mobile_device_fp": device(), "secondary_device_fps": [],
            "tablet_device_fp": None, "ip_subnet_base": subnet, "account_tier": random.choice(["Standard","Gold","Platinum"]),
            "account_open_date": (NOW-timedelta(days=random.randint(180,4000))).date().isoformat(),
            "avg_monthly_spend": random.choice([5000,15000,25000,45000,75000,120000]), "preferred_language": random.choice(["en","hi","ta","te","kn","mr"]),
            "has_mobile_app": "mobile_app" in available, "risk_segment": random.choice(["low","medium","high"]),
            "archetype": "dormant" if fully_dormant else "general", "active_channels": available,
            "dormant_channels": [c for c in CHANNEL_EVENTS if c not in available], "tags": ["fully_dormant"] if fully_dormant else ["general_portfolio"],
        })

    all_prior_events = json.loads((DATA / "events.json").read_text())
    # Re-anchor only the curated 51 profiles' events. Re-running this script
    # is meant to be safe/idempotent, but events.json also holds long-tail
    # events generated for customers[51:] by a *previous* run — folding those
    # back in here and then regenerating fresh ones below would double them
    # up every re-run. Keep only the curated slice; the loop further down
    # regenerates the long tail from scratch every time.
    original = [e for e in all_prior_events if e.get("customer_id_hint") in curated_ids]
    # Re-anchor curated data so it remains inside live 3/7/14/30-day views.
    old_latest = max(datetime.fromisoformat(e["occurred_at"].replace("Z","+00:00")) for e in original)
    for e in original:
        dt = datetime.fromisoformat(e["occurred_at"].replace("Z","+00:00"))
        e["occurred_at"] = (NOW - (old_latest-dt)).isoformat()
    events = original
    for c in customers[51:]:
        channels = c.get("active_channels", [])
        if not channels: continue
        sessions = random.randint(2,5)
        for s in range(sessions):
            ch = random.choice(channels); start = NOW-timedelta(days=random.randint(0,29),hours=random.randint(0,16),minutes=random.randint(0,59))
            for n in range(random.randint(2,5)):
                et = random.choice(CHANNEL_EVENTS[ch]); identity = {"phone_e164":c["phone_e164"]} if ch=="call_center" else {"user_id":c["customer_id"]}
                payload = {"queue":random.choice(["billing","service","fraud","retention"]),"reason":random.choice(["billing query","card delivery","payment clarification","profile update"])} if ch=="call_center" else {"journey":random.choice(["rewards","travel card","statement","loan offer"])}
                events.append({"event_id":event_id(),"customer_id_hint":c["customer_id"],"channel":ch,"event_type":et,"occurred_at":(start+timedelta(minutes=n*random.randint(2,12))).isoformat(),"session_id":f"sess-{uuid.uuid4().hex[:8]}","identity":identity,"signals":{"device_fp":c["mobile_device_fp"] if ch=="mobile_app" else c["primary_device_fp"],"ip_subnet":c["ip_subnet_base"]+".0/24","geo":c["home_geo"]},"payload":payload})
    events.sort(key=lambda x:x["occurred_at"])
    (DATA/"customers.json").write_text(json.dumps(customers,indent=2))
    (DATA/"ground_truth.json").write_text(json.dumps(customers,indent=2))
    (DATA/"events.json").write_text(json.dumps(events,indent=2))
    print(f"wrote {len(customers)} customers and {len(events)} multi-day events")

if __name__ == "__main__": main()
