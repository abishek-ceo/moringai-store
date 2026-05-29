// Frontend Razorpay checkout helper
async function startRazorpayPayment(cartItems, customerData) {
  // FIX: Send items to backend so amount is calculated server-side (prevents price tampering)
  const res = await fetch('/api/payments/create-order', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ items: cartItems })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create payment order');

  // FIX: Read Razorpay key from meta tag injected by server instead of undefined window global
  const razorpayKeyMeta = document.querySelector('meta[name="razorpay-key"]');
  const razorpayKey = razorpayKeyMeta ? razorpayKeyMeta.getAttribute('content') : '';
  if (!razorpayKey) throw new Error('Razorpay key not configured. Contact support.');

  return new Promise((resolve, reject) => {
    const options = {
      key: razorpayKey,
      amount: data.order.amount,  // Use amount from server response, not frontend calculation
      currency: 'INR',
      name: 'Moringai', description: 'Murungai Powder Order',
      order_id: data.order.id,
      handler: async function(response) {
        const verify = await fetch('/api/payments/verify', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(response)
        });
        const verified = await verify.json();
        if (!verified.success) return reject(new Error('Payment verification failed'));
        const orderRes = await fetch('/api/orders', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ ...customerData, items: cartItems, payment: { method:'razorpay', ...response } })
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok) return reject(new Error(orderData.error || 'Order creation failed'));
        resolve(orderData);
      },
      prefill: { name: customerData.customer, email: customerData.email, contact: customerData.phone },
      theme: { color: '#145c3a' }
    };
    const rzp = new Razorpay(options);
    rzp.on('payment.failed', r => reject(new Error(r.error.description || 'Payment failed')));
    rzp.open();
  });
}
