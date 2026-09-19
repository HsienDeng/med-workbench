"""Run with: python -m unittest test_menu_navigation."""

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Menu, RoleMenu
from app.services.menu_service import get_user_menus


class MenuNavigationTest(unittest.TestCase):
    def test_conversation_entries_are_visible_without_builtin_role(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine, tables=[Menu.__table__, RoleMenu.__table__])
        with Session(engine) as db:
            db.add_all([
                Menu(id=1, menu_key="new-conversation", route_key="assistant", title="新会话", sort_order=10),
                Menu(id=2, menu_key="clinical-hub", title="智能诊疗中心", sort_order=20),
                Menu(id=4, parent_id=2, menu_key="dashboard", route_key="dashboard", title="工作台总览", sort_order=20),
                RoleMenu(role_id=99, menu_id=4),
            ])
            db.commit()

            self.assertEqual(
                [(item["key"], item["parent_key"]) for item in get_user_menus(db, [])],
                [("new-conversation", None)],
            )
            self.assertEqual(
                [item["key"] for item in get_user_menus(db, [99])],
                ["new-conversation", "clinical-hub", "dashboard"],
            )
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
