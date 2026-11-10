CREATE TABLE topics (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    option_a VARCHAR(255) NOT NULL,
    option_b VARCHAR(255) NOT NULL,
    image_a_key VARCHAR(512) NULL,
    image_b_key VARCHAR(512) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT chk_topic_title
        CHECK (CHAR_LENGTH(TRIM(title)) > 0),
    CONSTRAINT chk_option_a
        CHECK (CHAR_LENGTH(TRIM(option_a)) > 0),
    CONSTRAINT chk_option_b
        CHECK (CHAR_LENGTH(TRIM(option_b)) > 0)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE votes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    topic_id BIGINT UNSIGNED NOT NULL,
    choice ENUM('A', 'B') NOT NULL,
    voter_token_hash CHAR(64)
        CHARACTER SET ascii
        COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT fk_votes_topic
        FOREIGN KEY (topic_id)
        REFERENCES topics(id),

    CONSTRAINT uq_topic_voter
        UNIQUE (topic_id, voter_token_hash)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    topic_id BIGINT UNSIGNED NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT fk_comments_topic
        FOREIGN KEY (topic_id)
        REFERENCES topics(id),

    CONSTRAINT chk_comment_content
        CHECK (CHAR_LENGTH(TRIM(content)) > 0),

    INDEX idx_comments_topic_created
        (topic_id, created_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;