/**
 * Famous Motivational Quotes Library for TimeBot
 */

const FAMOUS_QUOTES = [
    '💬 <i>"Thiên tài 1% là cảm hứng, 99% là mồ hôi."</i> — <b>Thomas Edison</b>',
    '💬 <i>"Hành trình vạn dặm bắt đầu từ một bước chân."</i> — <b>Lão Tử</b>',
    '💬 <i>"Cách duy nhất để làm nên sự nghiệp vĩ đại là yêu những gì bạn làm."</i> — <b>Steve Jobs</b>',
    '💬 <i>"Thành công không đến từ những gì bạn làm thỉnh thoảng, mà từ những gì bạn làm mỗi ngày."</i> — <b>Marie Forleo</b>',
    '💬 <i>"Đừng bao giờ từ bỏ ước mơ chỉ vì mất thời gian để thực hiện nó. Thời gian cũng sẽ trôi qua thôi."</i> — <b>Earl Nightingale</b>',
    '💬 <i>"Tôi không thất bại. Tôi chỉ vừa tìm ra 10.000 cách không hoạt động."</i> — <b>Thomas Edison</b>',
    '💬 <i>"Sự kiên trì chính là khác biệt duy nhất giữa người thành công và kẻ thất bại."</i> — <b>Elon Musk</b>',
    '💬 <i>"Hôm nay khó khăn, ngày mai sẽ tồi tệ hơn, nhưng ngày sau nữa sẽ là ánh mặt trời."</i> — <b>Jack Ma</b>',
    '💬 <i>"Nếu bạn không từ bỏ, bạn vẫn còn cơ hội. Từ bỏ là thất bại lớn nhất."</i> — <b>Jack Ma</b>',
    '💬 <i>"Kỷ luật là cầu nối giữa mục tiêu và thành tựu."</i> — <b>Jim Rohn</b>',
    '💬 <i>"Sự chuẩn bị tốt nhất cho ngày mai là làm hết sức mình trong ngày hôm nay."</i> — <b>H. Jackson Brown Jr.</b>',
    '💬 <i>"Người làm nên lịch sử không bao giờ dừng lại khi mệt mỏi, họ chỉ dừng lại khi đã hoàn thành."</i> — <b>Cristiano Ronaldo</b>',
    '💬 <i>"Thành công là khả năng đi từ thất bại này đến thất bại khác mà không mất đi lòng nhiệt huyết."</i> — <b>Winston Churchill</b>',
    '💬 <i>"Mọi việc đều có vẻ không thể cho đến khi nó được hoàn thành."</i> — <b>Nelson Mandela</b>'
];

function getRandomQuote() {
    const idx = Math.floor(Math.random() * FAMOUS_QUOTES.length);
    return FAMOUS_QUOTES[idx];
}

module.exports = {
    FAMOUS_QUOTES,
    getRandomQuote
};
