INSERT INTO payment_orders (order_no, user_id, amount, pay_type, subject, purpose, status) VALUES
('TEST_ALI_'||to_char(now(),'YYYYMMDDHH24MISS'), '6f6c54b4-7cba-4050-9168-4fc8f31be657', 1.00, 'alipay', '浏览器E2E测试-支付宝', 'test', 'pending'),
('TEST_WX_'||to_char(now(),'YYYYMMDDHH24MISS'), '6f6c54b4-7cba-4050-9168-4fc8f31be657', 1.00, 'wechat', '浏览器E2E测试-微信扫码', 'test', 'pending');