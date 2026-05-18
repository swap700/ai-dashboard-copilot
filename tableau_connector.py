import os
import tableauserverclient as TSC
import pandas as pd
from io import StringIO
from dotenv import load_dotenv

load_dotenv("ai_dashboard.env")

SERVER = os.getenv("TABLEAU_SERVER")
SITE_ID = os.getenv("TABLEAU_SITE")
TOKEN_NAME = os.getenv("TABLEAU_TOKEN_NAME")
TOKEN_SECRET = os.getenv("TABLEAU_TOKEN_SECRET")


def get_view_dataframe(view_name: str) -> pd.DataFrame:
    """
    Fetch a Tableau view by name and return it as a DataFrame.
    Raises ValueError if the view is not found.
    """
    auth = TSC.PersonalAccessTokenAuth(
        TOKEN_NAME,
        TOKEN_SECRET,
        site_id=SITE_ID
    )

    server = TSC.Server(SERVER, use_server_version=True)

    with server.auth.sign_in(auth):

        views, _ = server.views.get()

        # FIX: bare next() raises StopIteration if view name doesn't exist.
        # Using default=None and raising a clear ValueError instead.
        target_view = next((v for v in views if v.name == view_name), None)

        if target_view is None:
            available = [v.name for v in views]
            raise ValueError(
                f"View '{view_name}' not found on Tableau server.\n"
                f"Available views: {available}"
            )

        server.views.populate_csv(target_view)

        csv_data = b"".join(target_view.csv).decode("utf-8")

    df = pd.read_csv(StringIO(csv_data))

    return df
