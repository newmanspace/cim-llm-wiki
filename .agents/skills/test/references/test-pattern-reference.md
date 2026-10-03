# pytest 测试模式参考 (Test Pattern Reference)

> 本文件供 `test` 技能（以及 `code` 技能在 TDD 环节）生成测试用例时参考。

## 标准异步 API 测试模式

```python
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_get_order_detail_success():
    """Test successful retrieval of an order."""
    mock_service = AsyncMock()
    mock_service.get_order.return_value = {"order_id": "5127****7941", "status": "paid"}

    with patch("common.services.order_service.OrderService", return_value=mock_service):
        result = await get_order_detail(order_id="5127271815092007941")

    assert result["order_id"] == "5127****7941"
    assert "status" in result
    mock_service.get_order.assert_called_once()


@pytest.mark.asyncio
async def test_get_order_detail_not_found():
    """Test handling of non-existent order."""
    mock_service = AsyncMock()
    mock_service.get_order.side_effect = OrderNotFoundError("Not found")

    with patch("common.services.order_service.OrderService", return_value=mock_service):
        result = await get_order_detail(order_id="0000000000000000000")

    assert "error" in result
```

## 数据库查询测试模式

```python
@pytest.mark.asyncio
async def test_query_item_by_id():
    """Test database item retrieval with dict-style access."""
    mock_row = {"id": 1, "title": "Test Item", "price": 99.0, "created_at": "2026-01-01"}
    mock_db = AsyncMock()
    mock_db.fetchone.return_value = mock_row

    result = await get_item_by_id(db=mock_db, item_id=1)

    # ✅ 正确：通过列名访问
    assert result["title"] == "Test Item"
    # ❌ 禁止：通过索引访问 result[1]
```
