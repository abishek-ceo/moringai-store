// Frontend Razorpay checkout helper
async function startRazorpayPayment(cartItems, customerData) {
  const total = cartItems.reduce((a,b)=>a + (b.qty * b.price), 0);
  const res = await fetch('/api/payments/create-order', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ amount: total })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create payment order');
  return new Promise((resolve, reject) => {
    const options = {
      key: window.RAZORPAY_KEY_ID || '',
      amount: total * 100, currency: 'INR',
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
