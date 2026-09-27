// Sample team data for Blockwise.
// "Tiffin" is a fictional food-delivery backend team (Python / FastAPI / Postgres).
// SEED_REVIEWS is past review history that gets retained into Hindsight.
// DEMO_PRS are new pull requests the agent reviews live.

export const TEAM = {
  name: "Tiffin backend",
  stack: "Python 3.12, FastAPI, SQLAlchemy, Postgres, httpx",
  reviewers: ["Priya Raman", "Neha Iyer"],
  developers: ["Ravi Kumar", "Sana Sheikh", "Arjun Mehta"],
};

export const SEED_REVIEWS = [
  {
    pr: 97,
    date: "2026-08-04T10:12:00Z",
    title: "Add order history endpoint",
    author: "Arjun Mehta",
    reviewer: "Priya Raman",
    kind: "convention",
    transcript: `Priya Raman: Please don't query the database directly from the route handler in app/api/routes/orders.py. All database access goes through the repository layer in app/repositories/. Routes call services, services call repositories. It keeps handlers thin and lets us test services with fake repositories.
Arjun Mehta: Makes sense. Moved the query into OrderRepository.list_for_customer().
Priya Raman: Approved. Team rule going forward: no SQLAlchemy Session or session.query() inside app/api/routes.`,
  },
  {
    pr: 99,
    date: "2026-08-08T14:40:00Z",
    title: "Add GST to order totals",
    author: "Sana Sheikh",
    reviewer: "Priya Raman",
    kind: "convention",
    transcript: `Priya Raman: This computes price * 1.18 with floats and divides paise by 100. We never use float for money. All amounts are stored and computed as integer paise (int). Use app.money.apply_percent(amount_paise, basis_points), which rounds half-up and returns int paise. Convert to rupees only in the API response serializer.
Sana Sheikh: Switched to apply_percent(subtotal_paise, 1800).
Priya Raman: Approved. Float money caused a 1-paisa reconciliation mismatch with the payment gateway in July, which is why this rule exists.`,
  },
  {
    pr: 100,
    date: "2026-08-12T09:05:00Z",
    title: "Structured logs for order placement",
    author: "Ravi Kumar",
    reviewer: "Neha Iyer",
    kind: "rejected-suggestion",
    transcript: `Automated reviewer: Consider converting logger.info("Order %s placed for %s", order_id, customer_id) to an f-string for readability.
Neha Iyer: Rejecting this suggestion. We deliberately use %-style lazy logging arguments: the string is not formatted when the log level is disabled, and Sentry groups events by the unformatted message template. Please never suggest f-strings inside logging calls in this codebase.
Ravi Kumar: Keeping the %-style calls as they are.`,
  },
  {
    pr: 102,
    date: "2026-08-19T16:22:00Z",
    title: "Show restaurant name on order receipt",
    author: "Ravi Kumar",
    reviewer: "Priya Raman",
    kind: "recurring-mistake",
    transcript: `Priya Raman: RestaurantRepository.get_by_id() returns Optional[Restaurant]. The code uses restaurant.name without checking for None. This is exactly what caused incident INC-231 on 17 August (500s on the receipt page after a restaurant was deleted). When a repository returns None, raise app.errors.NotFoundError so the API returns a clean 404.
Priya Raman: Ravi, this is the second time an Optional return has been used without a None check in your PRs (also PR #91). Please double-check every repository .get() call.
Ravi Kumar: Added the None check and a test for the missing-restaurant case.`,
  },
  {
    pr: 104,
    date: "2026-08-26T11:30:00Z",
    title: "Call payment gateway to create payment intents",
    author: "Arjun Mehta",
    reviewer: "Priya Raman",
    kind: "convention",
    transcript: `Priya Raman: This creates a new httpx client with no timeout. Team rule: every outbound HTTP call uses the shared client from app.http.client (httpx.AsyncClient with timeout=5 seconds), and idempotent calls are wrapped in app.http.with_retry(max_attempts=3). Also, never use the requests library anywhere: it blocks the async event loop in FastAPI.
Arjun Mehta: Switched to app.http.client and wrapped the GET status call in with_retry.
Priya Raman: Approved.`,
  },
  {
    pr: 105,
    date: "2026-09-01T13:10:00Z",
    title: "Tests for delivery slot allocation",
    author: "Sana Sheikh",
    reviewer: "Neha Iyer",
    kind: "rejected-suggestion",
    transcript: `Automated reviewer: Add docstrings to each test function to describe what it verifies.
Neha Iyer: Rejecting this suggestion. Our test names follow test_<unit>_<condition>_<expected>, and the name is the documentation. We do not want docstrings on test functions. Please stop suggesting them.
Sana Sheikh: Leaving tests without docstrings.`,
  },
  {
    pr: 107,
    date: "2026-09-09T15:45:00Z",
    title: "Gateway webhook secret rotation",
    author: "Ravi Kumar",
    reviewer: "Priya Raman",
    kind: "convention",
    transcript: `Priya Raman: This reads os.getenv("GATEWAY_WEBHOOK_SECRET") inside the service. All configuration comes from app.config.settings (pydantic Settings). Never read os.environ or os.getenv outside app/config.py.
Priya Raman: Also, order.customer is accessed right after OrderRepository.get() without a None check again. Same pattern as PR #102.
Ravi Kumar: Moved to settings.gateway_webhook_secret and added the None check.`,
  },
  {
    pr: 109,
    date: "2026-09-16T10:20:00Z",
    title: "Payment captured webhook",
    author: "Sana Sheikh",
    reviewer: "Priya Raman",
    kind: "convention",
    transcript: `Priya Raman: Webhook endpoints must verify the HMAC signature before parsing the body: call app.security.verify_signature(raw_body, request.headers["X-Gateway-Signature"], settings.gateway_webhook_secret) and return 401 on failure. They must also be idempotent: record event_id in the processed_events table and skip events already seen, because the gateway retries deliveries.
Sana Sheikh: Added verification and the processed_events check.
Priya Raman: Approved. This applies to every gateway webhook, including refunds.`,
  },
];

export const DEMO_PRS = [
  {
    pr: 112,
    title: "Apply coupon discounts at checkout",
    author: "Sana Sheikh",
    date: "2026-09-24T11:00:00Z",
    note: "Breaks two team rules and tempts the reviewer into a suggestion the team rejected.",
    diff: `diff --git a/app/api/routes/checkout.py b/app/api/routes/checkout.py
--- a/app/api/routes/checkout.py
+++ b/app/api/routes/checkout.py
@@ -1,8 +1,34 @@
 from fastapi import APIRouter, Depends
+from sqlalchemy.orm import Session
+from app.db import get_session
+from app.models import Coupon, Cart
 from app.services.checkout import CheckoutService
+import logging
 
 router = APIRouter()
+logger = logging.getLogger(__name__)
 
+
+@router.post("/checkout/{cart_id}/apply-coupon")
+def apply_coupon(cart_id: int, code: str, session: Session = Depends(get_session)):
+    cart = session.query(Cart).filter(Cart.id == cart_id).first()
+    coupon = session.query(Coupon).filter(Coupon.code == code.upper()).first()
+    if not coupon or not coupon.active:
+        return {"error": "invalid coupon"}
+
+    subtotal = cart.subtotal_paise / 100
+    discount = subtotal * (coupon.percent_off / 100)
+    if discount > coupon.max_discount:
+        discount = coupon.max_discount
+    total = round(subtotal - discount, 2)
+
+    logger.info("Coupon %s applied to cart %s", code, cart_id)
+    cart.total = total
+    session.commit()
+    return {"subtotal": subtotal, "discount": discount, "total": total}`,
  },
  {
    pr: 113,
    title: "Handle refund webhook from payment gateway",
    author: "Ravi Kumar",
    date: "2026-09-25T15:30:00Z",
    note: "Repeats three mistakes from past reviews, two of them Ravi's own.",
    diff: `diff --git a/app/api/routes/webhooks.py b/app/api/routes/webhooks.py
--- a/app/api/routes/webhooks.py
+++ b/app/api/routes/webhooks.py
@@ -0,0 +1,24 @@
+import os
+import requests
+from fastapi import APIRouter, Request
+from app.repositories.orders import OrderRepository
+from app.services.refunds import RefundService
+
+router = APIRouter()
+
+
+@router.post("/webhooks/gateway/refund")
+async def refund_webhook(request: Request):
+    event = await request.json()
+    secret = os.getenv("GATEWAY_WEBHOOK_SECRET")
+
+    order = OrderRepository().get(event["order_id"])
+    RefundService().mark_refunded(order.id, event["amount_paise"])
+
+    requests.post(
+        "https://notify.tiffin.internal/push",
+        json={"customer_id": order.customer_id, "msg": "Refund processed"},
+    )
+    return {"ok": True}`,
  },
  {
    pr: 114,
    title: "Restaurant rating summary",
    author: "Arjun Mehta",
    date: "2026-09-26T10:10:00Z",
    note: "A clean PR. A reviewer that knows the team should stay quiet on style.",
    diff: `diff --git a/app/services/ratings.py b/app/services/ratings.py
--- a/app/services/ratings.py
+++ b/app/services/ratings.py
@@ -0,0 +1,19 @@
+import logging
+from app.repositories.ratings import RatingRepository
+
+logger = logging.getLogger(__name__)
+
+
+class RatingService:
+    def __init__(self, repo: RatingRepository):
+        self.repo = repo
+
+    def summary(self, restaurant_id: int) -> dict:
+        ratings = self.repo.list_for_restaurant(restaurant_id)
+        if not ratings:
+            return {"average": None, "count": 0}
+        avg = sum(r.stars for r in ratings) / len(ratings)
+        logger.info("Rating summary for %s: %.2f", restaurant_id, avg)
+        return {"average": round(avg, 1), "count": len(ratings)}
diff --git a/tests/test_ratings.py b/tests/test_ratings.py
--- a/tests/test_ratings.py
+++ b/tests/test_ratings.py
@@ -0,0 +1,10 @@
+from app.services.ratings import RatingService
+from tests.fakes import FakeRatingRepository, Rating
+
+def test_summary_no_ratings_returns_none_average():
+    repo = FakeRatingRepository([])
+    assert RatingService(repo).summary(1) == {"average": None, "count": 0}
+
+def test_summary_three_ratings_rounds_to_one_decimal():
+    repo = FakeRatingRepository([Rating(stars=4), Rating(stars=5), Rating(stars=5)])
+    assert RatingService(repo).summary(1)["average"] == 4.7`,
  },
];

// Turn a seed review into a Hindsight retain item.
export function seedToRetainItem(s) {
  return {
    content: `Code review of PR #${s.pr} "${s.title}" by ${s.author}, reviewed by ${s.reviewer} on ${s.date.slice(0, 10)}.\n${s.transcript}`,
    context: "code review thread for the Tiffin backend team",
    timestamp: s.date,
    document_id: `review-pr-${s.pr}`,
    tags: ["team:tiffin", "source:review", `kind:${s.kind}`, authorTag(s.author)],
    metadata: { pr: String(s.pr), author: s.author, reviewer: s.reviewer, kind: s.kind },
  };
}

export function authorTag(name) {
  return "author:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
