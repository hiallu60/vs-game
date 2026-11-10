INSERT INTO topics (title, option_a, option_b)
VALUES (
    '당신의 선택은?',
    '재입대하고 20억 받기',
    '그냥 10억 받기'
);

SELECT id, title, option_a, option_b
FROM topics;